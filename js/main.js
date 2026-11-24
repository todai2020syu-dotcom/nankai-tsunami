/* =========================================================
   ファイル：js/main.js
   役割　　：このアプリの「司令塔」。データを読み込み、ボタンや選択欄の操作を受けて、
             ほかのファイルの関数に「描いて」「動いて」と指示を出す
   読み込み：index.html でいちばん最後に読み込む（ほかのファイルの関数を使うため）

   ほかのファイルとのつながり（このファイルが呼ぶ関数）
     timeline.js      … drawTimeline(m)               到達時間のバー
     compare-2d.js    … drawCompare2D(高さ)           平面の高さくらべ
     compare-3d.js    … startCompare3D(高さ)          3Dの高さくらべ
     coast-map-3d.js  … initCoastMap / focusCoastMap / startCoastMapTimelapse / areaLatLng
     hazard-map.js    … initHazardMap / focusHazardMap

   流れ
     ページを開く → (3) データを読む → 選択欄・表・3D地図・浸水想定の地図を用意する
     市町村を選ぶ（選択欄 または 3D地図をタップ） → (5) showResult で結果を全部表示する

   ここにあるもの
     1. 使うHTMLの部品
     2. アプリの状態（読み込んだデータ・選んでいる市町村・平面か3Dか）
     3. はじめに：データを読み込んで準備する
     4. 市町村を選ぶ操作
     5. showResult：選んだ市町村の結果を表示する
     6. 平面と3Dの切り替え・もう一度見る
     7. 一覧の表を作る
   ========================================================= */


/* ---------------------------------------------------------
   1. 使うHTMLの部品
   --------------------------------------------------------- */
const citySelect = document.getElementById("city-select");     // 市町村の選択欄
const loadMessage = document.getElementById("search-message"); // 読み込み失敗のお知らせ
const resultSection = document.getElementById("result");       // 結果のまとまり（最初は隠れている）
const view2dButton = document.getElementById("view-2d");       // 「平面」ボタン
const view3dButton = document.getElementById("view-3d");       // 「3D」ボタン


/* ---------------------------------------------------------
   2. アプリの状態
   --------------------------------------------------------- */
let municipalities = []; // data.json の市町村の一覧（読み込んだら入る）
let current = null;      // 今選んでいる市町村（選んでいないときは null）
let compareView = "2d";  // 高さくらべを "2d"（平面）と "3d" のどちらで見ているか


/* ---------------------------------------------------------
   3. はじめに：データを読み込んで準備する
   --------------------------------------------------------- */

// 浸水想定の地図は、データの読み込みを待たずに作れる
initHazardMap();

// fetch("ファイル名") でファイルを読む。読み終わるまで少し時間がかかるので、
// .then(…) に「読めたら次にやること」を順に書く。失敗したら .catch(…) が動く。
fetch("data/data.json")
  .then((response) => response.json()) // 読んだ文字を、JSのデータ（オブジェクト）に直す
  .then((data) => {
    municipalities = data.municipalities;
    fillCitySelect();                          // 選択欄に市町村を並べる
    buildTable();                              // 一覧の表を作る
    initCoastMap(municipalities, pickByName);  // 3D地図を作る（タップされたら pickByName を呼ぶ）
  })
  .catch(() => {
    loadMessage.textContent = "データを読み込めませんでした。";
  });

// 選択欄（<select>）に、市町村を1つずつ <option> として足す
function fillCitySelect() {
  municipalities.forEach((m, index) => {
    const option = document.createElement("option");
    option.value = index;        // 何番目のデータか（選ばれたときに使う）
    option.textContent = m.name; // 画面に見える名前
    citySelect.appendChild(option);
  });
}


/* ---------------------------------------------------------
   4. 市町村を選ぶ操作
   --------------------------------------------------------- */

// 選択欄で選んだとき（"change" は「選ぶものが変わった」という出来事）
citySelect.addEventListener("change", () => {
  if (citySelect.value === "") {
    clearSelection();     // 「選んでください」に戻したときは、結果を隠し
    focusCoastMap(null);  // 3D地図も全体に戻す
    return;
  }
  current = municipalities[citySelect.value];
  showResult(current);
});

// 3D地図で市町村がタップされたとき（coast-map-3d.js から呼ばれる）
function pickByName(name) {
  const index = municipalities.findIndex((m) => m.name === name); // 何番目かを探す
  citySelect.value = index; // 選択欄も同じ市町村にそろえる
  current = municipalities[index];
  showResult(current);
}

// 選択を外して、結果を隠す
function clearSelection() {
  citySelect.value = "";
  current = null;
  resultSection.hidden = true;
}

// 3D地図の「時間の経過を見る」ボタン
document.getElementById("map-time").addEventListener("click", () => {
  clearSelection();
  startCoastMapTimelapse();
});

// 3D地図の「全体を見る」ボタン
document.getElementById("map-reset").addEventListener("click", () => {
  clearSelection();
  focusCoastMap(null);
});


/* ---------------------------------------------------------
   5. showResult：選んだ市町村の結果を表示する
      m … 1つの市町村のデータ（例：{ name: "室戸市", maxHeight: 23, arrival1m: 3, … }）
   --------------------------------------------------------- */
function showResult(m) {
  // (1) 数字を画面に入れる（textContent は「中の文字」）
  document.getElementById("result-name").textContent = m.prefecture + " " + m.name;
  document.getElementById("max-height").textContent = m.maxHeight;
  document.getElementById("arrival-1m").textContent = m.arrival1m;
  document.getElementById("arrival-3m").textContent = m.arrival3m;
  document.getElementById("arrival-5m").textContent = m.arrival5m;
  resultSection.hidden = false;

  // (2) 図を描く・地図を動かす（ほかのファイルの関数）
  drawTimeline(m);
  drawComparison();
  focusCoastMap(m.name);
  const place = areaLatLng(m.name); // 海岸の真ん中の緯度・経度
  if (place) focusHazardMap(place.lat, place.lng);

  // (3) 画面読み上げ向けの文
  writeScreenReaderText(m);
}

// 画面読み上げ向けの文を作る
function writeScreenReaderText(m) {
  // まとめ（index.html で role="status" にしているので、変わると読み上げられる）
  document.getElementById("sr-summary").textContent =
    m.prefecture + m.name + "。最大津波高は" + m.maxHeight + "メートル。" +
    "1メートルの津波は地震発生から" + m.arrival1m + "分、3メートルは" + m.arrival3m +
    "分、5メートルは" + m.arrival5m + "分で到達する想定です。";

  // 高さくらべの図の説明（平面と3Dの両方に付ける）
  const label =
    "海岸での津波の高さ" + m.maxHeight + "メートルの比較図。" +
    "人（1.7メートル）の約" + Math.round(m.maxHeight / 1.7) + "倍、" +
    "2階建ての家（約6メートル）の約" + (m.maxHeight / 6).toFixed(1) + "倍、" +
    "3階建ての建物（約9メートル）の約" + (m.maxHeight / 9).toFixed(1) + "倍の高さです。";
  document.getElementById("scene").setAttribute("aria-label", label);
  document.getElementById("scene3d").setAttribute("aria-label", label);
}


/* ---------------------------------------------------------
   6. 平面と3Dの切り替え・もう一度見る
   --------------------------------------------------------- */
view2dButton.addEventListener("click", () => switchCompareView("2d"));
view3dButton.addEventListener("click", () => switchCompareView("3d"));

function switchCompareView(newView) {
  compareView = newView;
  const is3d = compareView === "3d"; // true か false

  // 見せる・隠すを切り替える
  document.getElementById("scene").style.display = is3d ? "none" : "";
  document.getElementById("scene3d").hidden = !is3d;
  document.getElementById("legend-3d").hidden = !is3d;

  // ボタンの見た目（class="active"）と、読み上げ用の状態（aria-pressed）を切り替える
  view2dButton.classList.toggle("active", !is3d);
  view3dButton.classList.toggle("active", is3d);
  view2dButton.setAttribute("aria-pressed", String(!is3d));
  view3dButton.setAttribute("aria-pressed", String(is3d));

  drawComparison();
}

// 今のモード（平面か3D）で、高さくらべを描く
function drawComparison() {
  if (!current) return; // 市町村を選んでいなければ何もしない
  if (compareView === "3d") {
    startCompare3D(current.maxHeight);
  } else {
    drawCompare2D(current.maxHeight);
  }
}

// 「もう一度見る」ボタン：時間のバーと高さくらべを、最初から動かし直す
document.getElementById("replay-button").addEventListener("click", () => {
  if (!current) return;
  drawTimeline(current);
  drawComparison();
});


/* ---------------------------------------------------------
   7. 一覧の表を作る（地図が見えなくても、同じ情報を読めるように）
   --------------------------------------------------------- */
function buildTable() {
  const tbody = document.getElementById("table-body");
  municipalities.forEach((m) => {
    const tr = document.createElement("tr"); // 表の1行
    const cells = [m.name, m.maxHeight + "m", m.arrival1m + "分", m.arrival3m + "分", m.arrival5m + "分"];
    cells.forEach((text, i) => {
      // 1列目（市町村名）は見出しのマス <th>、ほかは <td>
      const cell = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) cell.scope = "row"; // 「この行の見出し」と読み上げソフトに伝える
      cell.textContent = text;
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  });
}
