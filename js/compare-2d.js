/* =========================================================
   ファイル：js/compare-2d.js
   役割　　：平面（SVG）の「高さくらべ」の絵を描き、水面を上げるアニメーションをする
   使うHTML：#scene（<svg> の部品）

   ほかのファイルとのつながり
     ・main.js から drawCompare2D(最大津波高) が呼ばれる
     ・common.js の ANIMATION_MS、progressOf、easeOut を使う

   絵の座標のしくみ
     index.html の <svg viewBox="0 0 400 300"> は「横400×縦300のマス目」の意味。
     SVGでは上が y=0 で、下に行くほど y が大きくなる。
     そのため「高さ(m)」を「y座標」に直す関数 toY を使う。

   ここにあるもの
     1. 使うHTMLの部品と、絵の大きさの決まり
     2. drawCompare2D：絵を全部描き直す
     3. 絵の部品を作る小さな関数（svgElement、drawBuilding、addCaption）
     4. animateWater：水面を上げるアニメーション
   ========================================================= */


/* ---------------------------------------------------------
   1. 使うHTMLの部品と、絵の大きさの決まり
   --------------------------------------------------------- */
const compareSvg = document.getElementById("scene");

const GROUND_Y = 280; // 地面の線の y座標
const TOP_Y = 20;     // 目盛りのいちばん上の y座標


/* ---------------------------------------------------------
   2. drawCompare2D：絵を全部描き直す
      maxHeight … 最大津波高（m）
   --------------------------------------------------------- */
function drawCompare2D(maxHeight) {
  compareSvg.innerHTML = ""; // 前の絵を消す

  // (1) 目盛りのいちばん上を何mにするか（津波より少し上まで。最低12m）
  const scaleMax = Math.max(12, Math.ceil((maxHeight * 1.2) / 5) * 5);
  // (2) 1mあたり何マスか
  const pxPerMeter = (GROUND_Y - TOP_Y) / scaleMax;
  // (3) 高さ(m)を y座標に直す関数（高いほど上＝yが小さい）
  const toY = (meters) => GROUND_Y - meters * pxPerMeter;

  // (4) 目盛り（2mごと。目盛りが多いときは5mごと）
  const step = scaleMax > 20 ? 5 : 2;
  for (let m = 0; m <= scaleMax; m += step) { // for は「くり返し」。m を step ずつ増やす
    compareSvg.appendChild(svgElement("line", { x1: 40, y1: toY(m), x2: 400, y2: toY(m), stroke: "#e3e3e3" }));
    const label = svgElement("text", { x: 34, y: toY(m) + 4, "text-anchor": "end", "font-size": 10, fill: "#555" });
    label.textContent = m + "m";
    compareSvg.appendChild(label);
  }

  // (5) 人（1.7m）：頭は丸、体は四角
  const personTop = toY(1.7);
  const head = (GROUND_Y - personTop) * 0.2;
  compareSvg.appendChild(svgElement("circle", { cx: 70, cy: personTop + head / 2, r: head / 2, fill: "#555" }));
  compareSvg.appendChild(svgElement("rect", { x: 66, y: personTop + head, width: 8, height: GROUND_Y - personTop - head, fill: "#555" }));
  addCaption(70, personTop, "人 1.7m");

  // (6) 建物（2階建て・約6m、3階建て・約9m）
  drawBuilding(110, 70, 6, toY, "2階建て 約6m");
  drawBuilding(210, 70, 9, toY, "3階建て 約9m");

  // (7) 地面
  compareSvg.appendChild(svgElement("line", { x1: 40, y1: GROUND_Y, x2: 400, y2: GROUND_Y, stroke: "#333", "stroke-width": 2 }));

  // (8) 水（最初は高さ0。アニメーションで上げる）と、水位の数字
  const water = svgElement("rect", { x: 40, y: GROUND_Y, width: 360, height: 0, fill: "rgba(47, 95, 122, 0.45)" });
  compareSvg.appendChild(water);
  const waterLabel = svgElement("text", { x: 395, y: GROUND_Y - 4, "text-anchor": "end", "font-size": 14, "font-weight": "bold", fill: "#2f5f7a" });
  compareSvg.appendChild(waterLabel);

  animateWater(water, waterLabel, maxHeight, toY);
}


/* ---------------------------------------------------------
   3. 絵の部品を作る小さな関数
   --------------------------------------------------------- */

// SVGの部品を作る。tag は "line" や "rect" など、attrs は { 名前: 値 } のまとまり（オブジェクト）
// 例：svgElement("rect", { x: 10, y: 20 }) → <rect x="10" y="20">
function svgElement(tag, attrs) {
  // SVGの部品は createElementNS（名前空間つき）で作る決まりがある
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const key in attrs) { // attrs の名前を1つずつ取り出すくり返し
    el.setAttribute(key, attrs[key]);
  }
  return el;
}

// 建物を描く（四角と、3mごとの階の線）
//   x … 左はしの位置、width … 幅、heightM … 高さ(m)、caption … 上に書く説明
function drawBuilding(x, width, heightM, toY, caption) {
  const top = toY(heightM);
  compareSvg.appendChild(svgElement("rect", { x: x, y: top, width: width, height: GROUND_Y - top, fill: "#cfd8dc", stroke: "#78909c" }));
  for (let m = 3; m < heightM; m += 3) {
    compareSvg.appendChild(svgElement("line", { x1: x, y1: toY(m), x2: x + width, y2: toY(m), stroke: "#78909c" }));
  }
  addCaption(x + width / 2, top, caption);
}

// 絵の上に小さな説明の文字を書く
function addCaption(x, y, text) {
  const t = svgElement("text", { x: x, y: y - 4, "text-anchor": "middle", "font-size": 10, fill: "#333" });
  t.textContent = text;
  compareSvg.appendChild(t);
}


/* ---------------------------------------------------------
   4. animateWater：水面を 0m → 最大津波高 まで、3秒かけて上げる
   --------------------------------------------------------- */
function animateWater(water, label, maxHeight, toY) {
  const start = performance.now();

  function frame(now) {
    const progress = progressOf(start, ANIMATION_MS, now); // 0〜1
    const level = maxHeight * easeOut(progress);            // 今の水位(m)

    water.setAttribute("y", toY(level));
    water.setAttribute("height", GROUND_Y - toY(level));
    label.setAttribute("y", toY(level) - 4);
    label.textContent = level.toFixed(1) + "m"; // toFixed(1) は小数点以下1けたの文字にする

    if (progress < 1) {
      requestAnimationFrame(frame); // 次のコマへ
    }
  }
  requestAnimationFrame(frame);
}
