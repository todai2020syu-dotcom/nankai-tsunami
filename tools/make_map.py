"""
高知県の市町村の形と海岸線を、3D地図用の data/map.json にまとめるプログラム

使い方（ターミナルで）:
    python tools/make_map.py <全国の市区町村TopoJSON> data/data.json data/map.json

  <全国の市区町村TopoJSON> は、スマートニュース メディア研究所が公開している
  data/municipality/topojson/s0010/N03-21_210101.json
  （https://github.com/smartnews-smri/japan-topography）

やっていること:
  1. TopoJSON の線（arc）を緯度・経度に戻す
  2. 全国で1回しか使われていない線を「海岸」とみなす（隣の市町村と接していない線）
  3. 高知県の市町村だけを取り出し、緯度・経度を km 単位の平面に直す
  4. 市町村名を data.json の名前とそろえて、map.json に書き出す
"""
import json, math, sys

# 引数（コマンドのあとに書いた3つ）を受け取る
src, data_json, out = sys.argv[1], sys.argv[2], sys.argv[3]
t = json.load(open(src, encoding="utf-8"))
sx, sy = t["transform"]["scale"]; tx, ty = t["transform"]["translate"]

# arcs を緯度経度に戻す（差分で記録されているので足し合わせる）
arcs = []
for arc in t["arcs"]:
    x = y = 0; pts = []
    for dx, dy in arc:
        x += dx; y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)

geoms = t["objects"]["N03-21_210101"]["geometries"]

def polys(g):
    return [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]

# 各 arc が全国で何回使われているか（1回だけ＝隣の市町村がない＝海岸）
use = [0] * len(arcs)
for g in geoms:
    if g["type"] not in ("Polygon", "MultiPolygon"): continue
    for poly in polys(g):
        for ring in poly:
            for a in ring:
                use[a if a >= 0 else ~a] += 1

# 投影：高知県の中心付近を原点にして、km単位の平面にする
LON0, LAT0 = 133.35, 33.45
def proj(p):
    lon, lat = p
    return [round((lon - LON0) * math.cos(math.radians(LAT0)) * 111.32, 2),
            round((lat - LAT0) * 110.57, 2)]

def ring_points(ring):
    pts = []
    for a in ring:
        seg = arcs[a] if a >= 0 else arcs[~a][::-1]
        pts.extend(seg if not pts else seg[1:])
    return pts

heights = {m["name"]: m for m in json.load(open(data_json, encoding="utf-8"))["municipalities"]}
result = []
for g in geoms:
    p = g["properties"]
    if p.get("N03_001") != "高知県": continue
    name = (p.get("N03_003") or "") + p["N03_004"]
    shapes, coast = [], []
    for poly in polys(g):
        shapes.append([[proj(q) for q in ring_points(r)] for r in poly])
        for ring in poly:
            for a in ring:
                if use[a if a >= 0 else ~a] == 1:
                    seg = arcs[a] if a >= 0 else arcs[~a][::-1]
                    coast.append([proj(q) for q in seg])
    result.append({"name": name, "shapes": shapes, "coast": coast,
                   "hasData": name in heights})
missing = [n for n in heights if n not in {r["name"] for r in result}]
print("市町村数:", len(result), " データと名前が合わない:", missing)
print("海岸ありでデータなし:", [r["name"] for r in result if r["coast"] and not r["hasData"]])
print("データありで海岸なし:", [r["name"] for r in result if r["hasData"] and not r["coast"]])
json.dump({"source": "国土交通省 国土数値情報（行政区域データ）をスマートニュース メディア研究所が簡素化したデータを加工して作成",
           "unit": "km", "origin": [LON0, LAT0], "municipalities": result},
          open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
