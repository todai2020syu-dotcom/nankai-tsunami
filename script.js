// ===== 使う部品（HTMLの要素）を取り出しておく =====
const select = document.getElementById("city-select");
const message = document.getElementById("search-message");
const result = document.getElementById("result");
const scene = document.getElementById("scene");
const replayButton = document.getElementById("replay-button");

// 読み込んだデータを入れておく箱
let municipalities = [];
// 今表示している市町村
let current = null;

// ===== ステップ2：data.json を読み込む =====
fetch("data.json")
  .then((response) => response.json())
  .then((data) => {
    municipalities = data.municipalities;
    // 選択欄（select）に市町村を1つずつ足す
    municipalities.forEach((m, index) => {
      const option = document.createElement("option");
      option.value = index;      // 何番目のデータか
      option.textContent = m.name; // 画面に見える名前
      select.appendChild(option);
    });
    buildTable(); // 地図の内容を表にする
    // 3D地図を作る。地図で市町村がタップされたら pickByName が呼ばれる
    initMap(municipalities, pickByName);
  })
  .catch(() => {
    message.textContent = "データを読み込めませんでした。";
  });

// ===== ステップ3：市町村を選ぶ =====
// 選択欄で市町村が選ばれたときに動く
select.addEventListener("change", () => {
  // 「選んでください」に戻したときは、結果を隠す
  if (select.value === "") {
    result.hidden = true;
    focusMap(null); // 地図は全体に戻す
    return;
  }

  current = municipalities[select.value];
  showResult(current);
});

// 地図でタップされた市町村を、選択欄でも選んだことにする
function pickByName(name) {
  const index = municipalities.findIndex((m) => m.name === name);
  select.value = index;
  current = municipalities[index];
  showResult(current);
}

// 地図の「時間の経過を見る」ボタン：選択を外す（地図の動きは map3d.js が担当）
document.getElementById("map-time").addEventListener("click", () => {
  select.value = "";
  result.hidden = true;
});

// 地図の「全体を見る」ボタン
document.getElementById("map-reset").addEventListener("click", () => {
  select.value = "";
  result.hidden = true;
  focusMap(null);
});

// 結果の数字を画面に入れる
function showResult(m) {
  document.getElementById("result-name").textContent = m.prefecture + " " + m.name;
  document.getElementById("max-height").textContent = m.maxHeight;
  document.getElementById("arrival-1m").textContent = m.arrival1m;
  document.getElementById("arrival-3m").textContent = m.arrival3m;
  document.getElementById("arrival-5m").textContent = m.arrival5m;
  result.hidden = false;

  drawTimeline(m);
  drawComparison();
  focusMap(m.name); // 3D地図をその市町村に寄せる
  // 浸水想定の地図も、その市町村へ動かす
  const place = areaLatLng(m.name);
  if (place && typeof focusHazardMap === "function") focusHazardMap(place.lat, place.lng);

  // 画面読み上げ用のまとめ（role="status" なので、変わると読み上げられる）
  document.getElementById("sr-summary").textContent =
    m.prefecture + m.name + "。最大津波高は" + m.maxHeight + "メートル。" +
    "1メートルの津波は地震発生から" + m.arrival1m + "分、3メートルは" + m.arrival3m +
    "分、5メートルは" + m.arrival5m + "分で到達する想定です。";

  // 高さくらべの絵の説明（平面と3Dの両方に付ける）
  const label =
    "海岸での津波の高さ" + m.maxHeight + "メートルの比較図。" +
    "人（1.7メートル）の約" + Math.round(m.maxHeight / 1.7) + "倍、" +
    "2階建ての家（約6メートル）の約" + (m.maxHeight / 6).toFixed(1) + "倍、" +
    "3階建ての建物（約9メートル）の約" + (m.maxHeight / 9).toFixed(1) + "倍の高さです。";
  scene.setAttribute("aria-label", label);
  document.getElementById("scene3d").setAttribute("aria-label", label);
}

// ===== 地図の内容を表にする（地図が見えなくても、同じ情報を読めるように） =====
function buildTable() {
  const tbody = document.getElementById("table-body");
  municipalities.forEach((m) => {
    const tr = document.createElement("tr");
    [m.name, m.maxHeight + "m", m.arrival1m + "分", m.arrival3m + "分", m.arrival5m + "分"].forEach((text, i) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) cell.scope = "row";
      cell.textContent = text;
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  });
}

// 「もう一度見る」ボタン（時間のバーと高さくらべを両方やり直す）
replayButton.addEventListener("click", () => {
  if (current) {
    drawTimeline(current);
    drawComparison();
  }
});

// ===== 平面と3Dの切り替え =====
const view2dButton = document.getElementById("view-2d");
const view3dButton = document.getElementById("view-3d");
const legend3d = document.getElementById("legend-3d");
let view = "2d"; // 今どちらを見ているか

view2dButton.addEventListener("click", () => switchView("2d"));
view3dButton.addEventListener("click", () => switchView("3d"));

function switchView(newView) {
  view = newView;
  const is3d = view === "3d";
  // 見せる・隠すを切り替える
  scene.style.display = is3d ? "none" : "";
  document.getElementById("scene3d").hidden = !is3d;
  legend3d.hidden = !is3d;
  // ボタンの色を切り替える
  view2dButton.classList.toggle("active", !is3d);
  view3dButton.classList.toggle("active", is3d);
  // 画面読み上げ用：どちらが選ばれているかを伝える
  view2dButton.setAttribute("aria-pressed", String(!is3d));
  view3dButton.setAttribute("aria-pressed", String(is3d));
  drawComparison();
}

// 今のモードで高さくらべを描く
function drawComparison() {
  if (!current) return;
  if (view === "3d") {
    start3D(current.maxHeight);
  } else {
    drawScene(current.maxHeight);
  }
}

// ===== ステップ5：到達時間のバー =====
const timeline = document.getElementById("timeline");
const clockMin = document.getElementById("clock-min");
let timelineAnimation = null; // 動いているアニメーションの番号（止めるときに使う）

function drawTimeline(m) {
  // 前のアニメーションが動いていたら止める
  if (timelineAnimation !== null) {
    cancelAnimationFrame(timelineAnimation);
  }
  timeline.innerHTML = "";

  // バーの右端を何分にするか（5mの津波より少し先まで見せる）
  const timeMax = Math.max(10, Math.ceil((m.arrival5m * 1.25) / 5) * 5);

  // 3つの行のもとになるデータ
  const items = [
    { label: "1mの津波", minutes: m.arrival1m },
    { label: "3mの津波", minutes: m.arrival3m },
    { label: "5mの津波", minutes: m.arrival5m },
  ];

  // 行を作る（ラベル｜バー｜◯分）
  const rows = items.map((item) => {
    const row = document.createElement("div");
    row.className = "time-row";

    const label = document.createElement("span");
    label.className = "time-label";
    label.textContent = item.label;

    const track = document.createElement("div");
    track.className = "time-track";
    track.setAttribute("aria-hidden", "true"); // 飾りのバーは読み上げない
    const fill = document.createElement("div");
    fill.className = "time-fill";
    const marker = document.createElement("div");
    marker.className = "time-marker";
    marker.style.left = (item.minutes / timeMax) * 100 + "%"; // 来る時点に印
    track.append(fill, marker);

    const value = document.createElement("span");
    value.className = "time-value";
    value.textContent = item.minutes + "分";

    row.append(label, track, value);
    timeline.appendChild(row);
    return { row, fill, value, minutes: item.minutes };
  });

  // 0分 → timeMax分 を、4秒かけて進める
  const duration = REDUCE_MOTION ? 1 : 4000;
  const start = performance.now();

  function frame(now) {
    const progress = Math.max(0, Math.min((now - start) / duration, 1));
    const minutesNow = timeMax * progress; // 今、地震から何分たったか

    clockMin.textContent = Math.floor(minutesNow);
    rows.forEach((r) => {
      r.fill.style.width = progress * 100 + "%";
      // 到達時間を過ぎたら、その行を赤くする
      if (minutesNow >= r.minutes && !r.row.classList.contains("arrived")) {
        r.row.classList.add("arrived");
        r.value.textContent = "到達 " + r.minutes + "分"; // 色だけでなく文字でも示す
      }
    });

    if (progress < 1) {
      timelineAnimation = requestAnimationFrame(frame);
    } else {
      timelineAnimation = null;
    }
  }
  timelineAnimation = requestAnimationFrame(frame);
}

// ===== ステップ4：高さくらべのアニメーション =====
// 絵の大きさ（viewBox 400×300 の中の位置）
const GROUND_Y = 280; // 地面の線の位置
const TOP_Y = 20;     // 一番上の目盛りの位置

// SVGの部品を作るための小さな関数
function svg(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const key in attrs) {
    el.setAttribute(key, attrs[key]);
  }
  return el;
}

function drawScene(maxHeight) {
  scene.innerHTML = ""; // 前の絵を消す

  // 目盛りの一番上を何mにするか（津波より少し上まで見せる）
  const scaleMax = Math.max(12, Math.ceil((maxHeight * 1.2) / 5) * 5);
  // 1mあたり何ピクセルか
  const pxPerMeter = (GROUND_Y - TOP_Y) / scaleMax;
  // 高さ(m)を、絵の中のy座標に変える
  const toY = (meters) => GROUND_Y - meters * pxPerMeter;

  // --- 目盛り ---
  const step = scaleMax > 20 ? 5 : 2;
  for (let m = 0; m <= scaleMax; m += step) {
    scene.appendChild(svg("line", { x1: 40, y1: toY(m), x2: 400, y2: toY(m), stroke: "#e3e3e3" }));
    const label = svg("text", { x: 34, y: toY(m) + 4, "text-anchor": "end", "font-size": 10, fill: "#555" });
    label.textContent = m + "m";
    scene.appendChild(label);
  }

  // --- 人（1.7m） ---
  const personTop = toY(1.7);
  const head = (GROUND_Y - personTop) * 0.2; // 頭の大きさ
  scene.appendChild(svg("circle", { cx: 70, cy: personTop + head / 2, r: head / 2, fill: "#555" }));
  scene.appendChild(svg("rect", { x: 66, y: personTop + head, width: 8, height: GROUND_Y - personTop - head, fill: "#555" }));
  addCaption(70, personTop, "人 1.7m");

  // --- 2階建ての家（約6m） ---
  drawBuilding(110, 70, 6, toY, "2階建て 約6m");

  // --- 3階建ての建物（約9m） ---
  drawBuilding(210, 70, 9, toY, "3階建て 約9m");

  // --- 地面 ---
  scene.appendChild(svg("line", { x1: 40, y1: GROUND_Y, x2: 400, y2: GROUND_Y, stroke: "#333", "stroke-width": 2 }));

  // --- 水（最初は高さ0。あとでアニメーションで上げる） ---
  const water = svg("rect", { x: 40, y: GROUND_Y, width: 360, height: 0, fill: "rgba(47, 95, 122, 0.45)" });
  scene.appendChild(water);
  const waterLabel = svg("text", { x: 395, y: GROUND_Y - 4, "text-anchor": "end", "font-size": 14, "font-weight": "bold", fill: "#2f5f7a" });
  scene.appendChild(waterLabel);

  animateWater(water, waterLabel, maxHeight, toY);
}

// 建物を描く（四角＋窓の線）
function drawBuilding(x, width, heightM, toY, caption) {
  const top = toY(heightM);
  scene.appendChild(svg("rect", { x: x, y: top, width: width, height: GROUND_Y - top, fill: "#cfd8dc", stroke: "#78909c" }));
  // 3mごとに階の区切り線
  for (let m = 3; m < heightM; m += 3) {
    scene.appendChild(svg("line", { x1: x, y1: toY(m), x2: x + width, y2: toY(m), stroke: "#78909c" }));
  }
  addCaption(x + width / 2, top, caption);
}

// 絵の上に小さな説明を書く
function addCaption(x, y, text) {
  const t = svg("text", { x: x, y: y - 4, "text-anchor": "middle", "font-size": 10, fill: "#333" });
  t.textContent = text;
  scene.appendChild(t);
}

// 水位を 0m → 最大津波高 まで、3秒かけて上げる
function animateWater(water, label, maxHeight, toY) {
  const duration = ANIMATION_MS; // ミリ秒（動きを減らす設定なら、すぐ終わる）
  const start = performance.now();

  function frame(now) {
    const progress = Math.max(0, Math.min((now - start) / duration, 1)); // 0 → 1（はみ出さないように）
    const eased = 1 - Math.pow(1 - progress, 3);           // 最後はゆっくり止まる
    const level = maxHeight * eased;                        // 今の水位(m)

    water.setAttribute("y", toY(level));
    water.setAttribute("height", GROUND_Y - toY(level));
    label.setAttribute("y", toY(level) - 4);
    label.textContent = level.toFixed(1) + "m";

    if (progress < 1) {
      requestAnimationFrame(frame); // 次のコマへ
    }
  }
  requestAnimationFrame(frame);
}
