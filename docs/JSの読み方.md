# JSの読み方ガイド

このアプリのJavaScriptを、初めて読む人向けに説明したメモです。
各ファイルの先頭にも「役割・使うHTMLの部品・ほかのファイルとのつながり・目次」を書いています。

## 1. フォルダの構成

```
nankai-tsunami/
├── index.html        画面の骨組み（どこに何を置くか）
├── style.css         見た目（色・大きさ・並べ方）
├── js/               動き（JavaScript）
│   ├── common.js        共通の設定と小さな道具
│   ├── timeline.js      到達時間のバー
│   ├── compare-2d.js    平面の高さくらべ
│   ├── compare-3d.js    3Dの高さくらべ
│   ├── coast-map-3d.js  高知県の3D地図（海岸の壁・時間の経過）
│   ├── hazard-map.js    浸水想定・高台・避難場所の地図
│   └── main.js          司令塔（データを読み、ほかに指示を出す）
├── data/             データ
│   ├── data.json        19市町村の最大津波高と到達時間
│   └── map.json         市町村の形と海岸線（tools/make_map.py で作った）
├── tools/
│   └── make_map.py      map.json を作るPythonのプログラム
└── docs/
    └── JSの読み方.md    このファイル
```

## 2. 全体の流れ

```
ページを開く
  │
  ├─ index.html が JS を上から順に読む
  │    common.js → timeline.js → compare-2d.js → compare-3d.js
  │    → coast-map-3d.js → hazard-map.js → main.js（最後）
  │
  └─ main.js が動き始める
       ├─ initHazardMap()            浸水想定の地図を作る
       └─ data/data.json を読む
            ├─ 選択欄に19市町村を並べる
            ├─ 一覧の表を作る
            └─ initCoastMap()        3D地図を作る

市町村を選ぶ（選択欄 または 3D地図をタップ）
  └─ main.js の showResult()
       ├─ 数字を画面に入れる
       ├─ drawTimeline()           到達時間のバー（timeline.js）
       ├─ drawCompare2D() / startCompare3D()  高さくらべ（compare-2d.js / compare-3d.js）
       ├─ focusCoastMap()          3D地図をその市町村へ（coast-map-3d.js）
       └─ focusHazardMap()         浸水想定の地図をその市町村へ（hazard-map.js）
```

ポイント：**main.js だけが全体を知っていて、ほかのファイルは自分の担当だけをする**。
困ったときは、まず main.js の showResult() から読むと、どこで何をしているかたどれます。

## 3. 読み込む順番が大事な理由

`<script>` は上から順に読まれます。
main.js はほかのファイルの関数（drawTimeline など）を使うので、最後に読む必要があります。
common.js はほかの全部が使うので、最初に読みます。

## 4. このアプリで使っているJSの書き方

| 書き方 | 意味 | 例 |
| --- | --- | --- |
| `const 名前 = 値` | あとで入れ替えない箱 | `const WALL_SCALE = 0.25;` |
| `let 名前 = 値` | あとで入れ替える箱 | `let current = null;` |
| `function 名前(引数) { … }` | 関数（ひとまとまりの処理）を作る | `function drawTimeline(m) { … }` |
| `(x) => { … }` | 関数の短い書き方（アロー関数） | `items.map((item) => …)` |
| `{ 名前: 値 }` | オブジェクト（関係する値のまとまり） | `{ name: "室戸市", maxHeight: 23 }` |
| `[a, b, c]` | 配列（順番に並べた値） | `[3, 3, 4]` |
| `条件 ? A : B` | 条件が正しければA、違えばB | `is3d ? "none" : ""` |
| `document.getElementById("id")` | HTMLの部品を取り出す | `document.getElementById("result")` |
| `部品.addEventListener("出来事", 関数)` | 出来事が起きたら関数を動かす | `"click"`（押した）、`"change"`（選んだ） |
| `部品.textContent = "文字"` | 部品の中の文字を入れる | 結果の数字を表示する |
| `部品.hidden = true` | 部品を隠す（false で見せる） | 結果を隠す |
| `配列.forEach((x) => …)` | 配列の1つ1つに処理をする | 選択欄に市町村を足す |
| `配列.map((x) => …)` | 1つ1つを変換して新しい配列を作る | 行のデータからバーの部品を作る |
| `配列.find((x) => 条件)` | 条件に合う最初の1つを探す | 名前から市町村を探す |
| `fetch("ファイル").then(…)` | ファイルを読み、読めたら次をする | data.json を読む |
| `async` / `await` | 時間のかかる処理を待ってから次へ | 地図画像の色を読む |
| `requestAnimationFrame(関数)` | 次の画面の書き換えのときに関数を呼ぶ（アニメーション） | 水面を少しずつ上げる |

## 5. よくある変更のしかた

- **色を変えたい**：style.css の先頭の `:root { --paper: …; --ink: …; }` を変えると、ページ全体の色が変わります。3D地図の壁の色は coast-map-3d.js の `HEIGHT_CLASSES`、凡例は index.html の `map-legend` を一緒に変えます。
- **アニメーションの長さを変えたい**：common.js の `ANIMATION_MS`（3000 = 3秒）。到達時間のバーは timeline.js の `4000`。
- **地図の壁の強調の倍率を変えたい**：coast-map-3d.js の `WALL_SCALE`。変えたら、index.html の「250倍」の説明も直します。
- **市町村を増やしたい（徳島など）**：data/data.json に行を足し、tools/make_map.py で map.json を作り直します（県の絞り込み「高知県」を変える）。

## 6. 動かして確かめるとき

- index.html をダブルクリックで開くと、データ（data/）が読み込めません。VS Code の「Live Server」で開きます。
- 浸水想定・高台・避難場所の地図は、国のサーバーから読み込むため、公開ページ（GitHub Pages）かインターネットにつながった Live Server で確かめます。
- うまく動かないときは、ブラウザで F12 を押し、「Console」に赤い文字（エラー）が出ていないかを見ます。エラーにはファイル名と行番号が書かれています。
