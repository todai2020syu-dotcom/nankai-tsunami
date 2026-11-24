/* =========================================================
   ファイル：js/hazard-map.js
   役割　　：浸水想定・土地の高さ（高台）・津波の避難場所を重ねた地図。
             地図を押すと、その地点の「想定浸水深」「標高」「近い津波避難場所」を文字で示す
   使うHTML：#hazard-map（地図の枠）、#hazard-info（押した地点の結果）、
             #hazard-drag（スマホで指で動かすかの切り替え）、[data-layer]（表示の切り替え）
   使う道具：Leaflet（2Dの地図ライブラリ。index.html でインターネットから読み込む）
   使うデータ：国のサーバーにある地図画像（タイル）とデータ。公開したページでだけ動く

   ほかのファイルとのつながり
     main.js から呼ばれる関数
       ・initHazardMap()              … 地図を作る
       ・focusHazardMap(緯度, 経度)   … その場所へ地図を動かす
     common.js の REDUCE_MOTION を使う

   「タイル」とは
     Webの地図は、256×256ピクセルの小さな画像（タイル）を敷きつめて表示している。
     タイルの場所は「ズーム(z)・横の番号(x)・縦の番号(y)」で決まり、URLの {z}/{x}/{y} に入る。

   ここにあるもの
     1. 使うHTMLの部品と、地図画像・データの場所
     2. 浸水の深さの色の対応表
     3. initHazardMap：地図を作る
     4. focusHazardMap：市町村の場所へ動かす
     5. 地図画像の1点の色を読む（浸水深・標高を調べる）
     6. 避難場所を読み込んで印を置く
     7. describePoint：押した地点の情報を文字で出す
   ========================================================= */


/* ---------------------------------------------------------
   1. 使うHTMLの部品と、地図画像・データの場所
   --------------------------------------------------------- */
const hazardBox = document.getElementById("hazard-map");
const hazardInfo = document.getElementById("hazard-info");

const TILE = {
  // 国土地理院の淡色地図（土台）
  base: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
  // ハザードマップポータルサイトの津波浸水想定（色＝浸水の深さ）
  tsunami: "https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png",
  // 国土地理院の色別標高図（色＝土地の高さ。高台を見つける）
  relief: "https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png",
  // 国土地理院の標高タイル（数値。押した地点の標高を計算する）
  dem: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
  // 国土地理院の指定緊急避難場所（skhb05 ＝ 津波）
  shelter: "https://cyberjapandata.gsi.go.jp/xyz/skhb05/{z}/{x}/{y}.geojson",
};

/* ---------------------------------------------------------
   2. 浸水の深さの色の対応表（ハザードマップポータルサイトの凡例）
      地図画像の色を読み取り、いちばん近い色の区分を「その地点の浸水深」とする
   --------------------------------------------------------- */
const DEPTH_CLASSES = [
  { rgb: [255, 255, 179], label: "0.3m未満" },
  { rgb: [247, 245, 169], label: "0.3〜0.5m" },
  { rgb: [248, 225, 166], label: "0.5〜1.0m" },
  { rgb: [255, 216, 192], label: "1.0〜3.0m" },
  { rgb: [255, 183, 183], label: "3.0〜5.0m" },
  { rgb: [255, 145, 145], label: "5.0〜10.0m" },
  { rgb: [242, 133, 201], label: "10.0〜20.0m" },
  { rgb: [220, 122, 220], label: "20.0m以上" },
];

// 地図で使うものをまとめる箱
const hazardMap = {
  leaflet: null,         // Leaflet の地図そのもの
  layers: {},            // 重ねる地図（浸水想定・高さ・避難場所）
  shelters: [],          // 読み込んだ避難場所 { name, address, lat, lng }
  loadedShelterTiles: {},// 読み込み済みのデータの番号（同じものを2回読まない）
  shelterIds: new Set(), // 登録済みの避難場所（重なりを防ぐ）
  pin: null,             // 押した地点の印
};

/* ---------------------------------------------------------
   3. initHazardMap：地図を作る（main.js から1回呼ばれる）
   --------------------------------------------------------- */
function initHazardMap() {
  if (typeof L === "undefined") {
    hazardInfo.textContent = "地図のライブラリを読み込めませんでした。";
    return;
  }
  // スマホでは、最初は指で地図を動かせないようにする（ページのスクロールと混ざらないように）。
  // 「指で地図を動かす」ボタンでオンにできる。拡大・縮小は＋－ボタンと2本指でできる
  const touch = L.Browser.mobile;
  hazardMap.leaflet = L.map(hazardBox, { zoomControl: true, minZoom: 8, maxZoom: 17, dragging: !touch })
    .setView([33.45, 133.35], 9); // 高知県の真ん中あたり

  const dragButton = document.getElementById("hazard-drag");
  if (!touch) {
    dragButton.hidden = true; // PCではマウスで動かせるので、ボタンは要らない
  }
  dragButton.addEventListener("click", () => {
    const on = !hazardMap.leaflet.dragging.enabled();
    if (on) hazardMap.leaflet.dragging.enable();
    else hazardMap.leaflet.dragging.disable();
    dragButton.setAttribute("aria-pressed", String(on));
    dragButton.textContent = "指で地図を動かす：" + (on ? "オン" : "オフ");
  });

  const gsi = '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>';
  L.tileLayer(TILE.base, { attribution: gsi, maxZoom: 17 }).addTo(hazardMap.leaflet);

  hazardMap.layers.tsunami = L.tileLayer(TILE.tsunami, {
    attribution: '津波浸水想定：<a href="https://disaportal.gsi.go.jp/">ハザードマップポータルサイト</a>',
    opacity: 0.8,
    maxNativeZoom: 17,
  });
  hazardMap.layers.relief = L.tileLayer(TILE.relief, { attribution: "色別標高図：" + gsi, opacity: 0.55, maxNativeZoom: 15 });
  hazardMap.layers.shelter = L.layerGroup();

  hazardMap.layers.tsunami.addTo(hazardMap.leaflet);
  hazardMap.layers.shelter.addTo(hazardMap.leaflet);

  // 表示する情報の切り替え（チェックボックス）
  document.querySelectorAll("[data-layer]").forEach((box) => {
    box.addEventListener("change", () => {
      const layer = hazardMap.layers[box.dataset.layer];
      if (box.checked) layer.addTo(hazardMap.leaflet);
      else hazardMap.leaflet.removeLayer(layer);
    });
  });

  // 地図を動かしたら、見えている範囲の避難場所を読み込む
  hazardMap.leaflet.on("moveend", loadVisibleShelters);
  loadVisibleShelters();

  // 地図を押したら、その地点の情報を調べる
  hazardMap.leaflet.on("click", (e) => describePoint(e.latlng));
}

/* ---------------------------------------------------------
   4. focusHazardMap：市町村を選んだら、その場所へ地図を動かす（main.js から呼ばれる）
   --------------------------------------------------------- */
function focusHazardMap(lat, lng) {
  if (!hazardMap.leaflet) return;
  if (REDUCE_MOTION) hazardMap.leaflet.setView([lat, lng], 12);
  else hazardMap.leaflet.flyTo([lat, lng], 12, { duration: 1.2 });
}

/* ---------------------------------------------------------
   5. 地図画像の1点の色を読む
      緯度・経度を「何枚目のタイルの、どの点か」に直し、その点の色から浸水深や標高を出す
   --------------------------------------------------------- */
function toTilePixel(lat, lng, z) {
  const n = 256 * Math.pow(2, z);
  const x = ((lng + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { tx: Math.floor(x / 256), ty: Math.floor(y / 256), px: Math.floor(x) % 256, py: Math.floor(y) % 256 };
}

// 地図画像の1点の色を読む（読めないときは null）
async function readPixel(template, lat, lng, z) {
  const t = toTilePixel(lat, lng, z);
  const url = template.replace("{z}", z).replace("{x}", t.tx).replace("{y}", t.ty);
  const response = await fetch(url);
  if (!response.ok) return null; // その場所に画像がない
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(t.px, t.py, 1, 1).data; // [赤, 緑, 青, 透明度]
}

// 押した地点の想定浸水深（色から区分を読み取る）
async function depthAt(lat, lng) {
  const z = Math.min(Math.max(Math.round(hazardMap.leaflet.getZoom()), 10), 17);
  const p = await readPixel(TILE.tsunami, lat, lng, z);
  if (!p || p[3] === 0) return null; // 色が付いていない
  let best = null;
  let bestDistance = Infinity;
  DEPTH_CLASSES.forEach((c) => {
    const d = Math.hypot(p[0] - c.rgb[0], p[1] - c.rgb[1], p[2] - c.rgb[2]);
    if (d < bestDistance) { bestDistance = d; best = c; }
  });
  return bestDistance < 40 ? best.label : "不明（色を読み取れませんでした）";
}

// 押した地点の標高（標高タイルの色から計算する。国土地理院の仕様どおり）
async function elevationAt(lat, lng) {
  const p = await readPixel(TILE.dem, lat, lng, 14);
  if (!p) return null;
  const v = p[0] * 65536 + p[1] * 256 + p[2];
  if (v === 8388608) return null;            // データなし
  return v < 8388608 ? v * 0.01 : (v - 16777216) * 0.01;
}

/* ---------------------------------------------------------
   6. 避難場所を読み込んで印を置く
      国土地理院の「指定緊急避難場所」は災害の種類ごとに分かれていて、skhb05 が津波用
   --------------------------------------------------------- */
// 見えている範囲の避難場所データ（ズーム10の区切りごと）を読み込む
function loadVisibleShelters() {
  const bounds = hazardMap.leaflet.getBounds();
  if (hazardMap.leaflet.getZoom() < 11) {
    hazardMap.leaflet.removeLayer(hazardMap.layers.shelter); // 広く見ているときは数が多すぎるので出さない
    return;
  }
  if (document.querySelector('[data-layer="shelter"]').checked) hazardMap.layers.shelter.addTo(hazardMap.leaflet);
  const a = toTilePixel(bounds.getNorth(), bounds.getWest(), 10);
  const b = toTilePixel(bounds.getSouth(), bounds.getEast(), 10);
  for (let x = a.tx; x <= b.tx; x++) {
    for (let y = a.ty; y <= b.ty; y++) loadShelterTile(x, y);
  }
}

async function loadShelterTile(x, y) {
  const key = x + "/" + y;
  if (hazardMap.loadedShelterTiles[key]) return hazardMap.loadedShelterTiles[key];
  const url = TILE.shelter.replace("{z}", 10).replace("{x}", x).replace("{y}", y);
  hazardMap.loadedShelterTiles[key] = fetch(url)
    .then((r) => (r.ok ? r.json() : { features: [] }))
    .then((geo) => {
      geo.features.forEach((f) => {
        const [lng, lat] = f.geometry.coordinates;
        // 同じ避難場所を2回登録しない（名前と位置で見分ける）
        const id = f.properties.name + "@" + lat + "," + lng;
        if (hazardMap.shelterIds.has(id)) return;
        hazardMap.shelterIds.add(id);
        const s = { name: f.properties.name, address: f.properties.address || "", lat, lng };
        hazardMap.shelters.push(s);
        // 印は「白い縁取りの墨色の四角」。色だけでなく形でも浸水の色と区別する
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({ className: "shelter-icon", iconSize: [14, 14] }),
          title: s.name, // 読み上げ・マウスを乗せたときの名前
          keyboard: false,
        });
        marker.bindPopup(() => {
          const div = document.createElement("div");
          const strong = document.createElement("strong");
          strong.textContent = s.name;
          div.append(strong, document.createElement("br"), s.address);
          return div;
        });
        hazardMap.layers.shelter.addLayer(marker);
      });
    })
    .catch(() => {});
  return hazardMap.loadedShelterTiles[key];
}

// 2点間の直線距離（m）
function distance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ---------------------------------------------------------
   7. describePoint：押した地点の情報をまとめて文字で出す
      async と await は「時間のかかる読み込みを待ってから次へ進む」ための書き方
   --------------------------------------------------------- */
async function describePoint(latlng) {
  const { lat, lng } = latlng;
  if (hazardMap.pin) hazardMap.leaflet.removeLayer(hazardMap.pin);
  hazardMap.pin = L.circleMarker(latlng, { radius: 8, color: "#1f2a33", weight: 3, fillColor: "#fff", fillOpacity: 1 }).addTo(hazardMap.leaflet);
  hazardInfo.textContent = "調べています…";

  // 押した地点のまわり（3×3区切り）の避難場所を読み込んでから、近い順に並べる
  const t = toTilePixel(lat, lng, 10);
  const loads = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) loads.push(loadShelterTile(t.tx + dx, t.ty + dy));

  const [depth, elevation] = await Promise.all([
    depthAt(lat, lng).catch(() => "不明（読み込めませんでした）"),
    elevationAt(lat, lng).catch(() => null),
    Promise.all(loads),
  ]);

  const nearest = hazardMap.shelters
    .map((s) => ({ ...s, d: distance(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  // 結果を組み立てる（textContent を使い、データの文字をそのまま表示する）
  hazardInfo.innerHTML = "";
  const add = (label, value) => {
    const p = document.createElement("p");
    const b = document.createElement("strong");
    b.textContent = label;
    p.append(b, value);
    hazardInfo.appendChild(p);
  };
  add("想定浸水深：", depth ? depth : "この地図では、浸水の色が付いていない場所です（浸水しないという意味ではありません）");
  add("標高：", elevation === null ? "不明" : "約" + elevation.toFixed(1) + "m");
  if (nearest.length > 0) {
    const p = document.createElement("p");
    const b = document.createElement("strong");
    b.textContent = "近い津波避難場所（直線距離）：";
    p.appendChild(b);
    const ol = document.createElement("ol");
    nearest.forEach((s) => {
      const li = document.createElement("li");
      // 1km未満はm、それ以上はkmで示す
      const text = s.d < 1000 ? Math.round(s.d / 10) * 10 + "m" : (s.d / 1000).toFixed(1) + "km";
      li.textContent = s.name + "（約" + text + "）";
      ol.appendChild(li);
    });
    hazardInfo.append(p, ol);
  } else {
    add("近い津波避難場所：", "この付近のデータが見つかりませんでした");
  }
}
