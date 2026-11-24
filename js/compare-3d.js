/* =========================================================
   ファイル：js/compare-3d.js
   役割　　：3Dの「高さくらべ」。人・家・ビルの周りで水面が上がる様子を立体で見せる
   使うHTML：#scene3d（3Dの絵を入れる枠）、#water-level-3d（水位の数字）
   使う道具：Three.js（3Dを描くライブラリ。index.html でインターネットから読み込む）

   ほかのファイルとのつながり
     ・main.js から startCompare3D(最大津波高) が呼ばれる
     ・common.js の REDUCE_MOTION、ANIMATION_MS、progressOf、easeOut を使う

   3Dの基本
     renderer（絵を描く係）・scene（舞台）・camera（カメラ）・light（光）・mesh（形＋材質）
     長さの単位は「1 = 1m」。上下は y、左右は x、手前と奥は z。

   ここにあるもの
     1. 使うHTMLの部品と、3Dの部品をまとめる箱（compare3d）
     2. setupCompare3D：最初の1回だけ舞台を組み立てる
     3. 舞台の部品を作る関数（addBuilding、makePole）
     4. 操作：横になぞると回る（setupCompare3DDrag）
     5. startCompare3D：市町村が選ばれたときに水面を上げ直す
     6. loopCompare3D：毎コマ描き直す
   ========================================================= */


/* ---------------------------------------------------------
   1. 使うHTMLの部品と、3Dの部品をまとめる箱
   --------------------------------------------------------- */
const compare3dBox = document.getElementById("scene3d");
const waterLevelText = document.getElementById("water-level-3d");

// { 名前: 値, … } は「オブジェクト」。関係のある値を1つにまとめておける。
// compare3d.water のように「.名前」で中身を使う。
const compare3d = {
  ready: false,    // 舞台の準備ができたか
  renderer: null,  // 絵を描く係
  scene: null,     // 舞台
  camera: null,    // カメラ
  water: null,     // 水
  pole: null,      // 5mごとの目盛りの柱
  maxHeight: 0,    // 今の市町村の最大津波高
  waterStart: 0,   // 水が上がり始めた時刻
  angle: 0.6,      // カメラの横の向き（ラジアン。約6.28で1周）
  dragging: false, // 指でなぞっている最中か
  lastX: 0,        // 直前の指の横位置
};


/* ---------------------------------------------------------
   2. setupCompare3D：最初の1回だけ舞台を組み立てる
      うまくいけば true、Three.js が読めなかったら false を返す
   --------------------------------------------------------- */
function setupCompare3D() {
  // typeof THREE === "undefined" は「THREE（Three.js）が無い」という意味
  if (typeof THREE === "undefined") {
    waterLevelText.textContent = "3Dを読み込めませんでした";
    return false;
  }

  // (1) 絵を描く係と、絵を入れる <canvas>
  compare3d.renderer = new THREE.WebGLRenderer({ antialias: true });
  compare3d.renderer.setPixelRatio(window.devicePixelRatio);
  compare3dBox.appendChild(compare3d.renderer.domElement);
  // 説明は外側の枠（#scene3d）の aria-label で読み上げるので、canvas 自体は読まない
  compare3d.renderer.domElement.setAttribute("aria-hidden", "true");

  // (2) 舞台とカメラ
  compare3d.scene = new THREE.Scene();
  compare3d.scene.background = new THREE.Color(0xdce7ee); // 0x… は色の番号（CSSの #dce7ee と同じ）
  compare3d.camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 1000);

  // (3) 光：全体をうっすら照らす光＋太陽のような光（光がないと真っ黒になる）
  compare3d.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(30, 60, 40);
  compare3d.scene.add(sun);

  // (4) 地面（50m四方、厚さ0.2m）
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(50, 0.2, 50),                        // 形：箱
    new THREE.MeshLambertMaterial({ color: 0xb0bec5 })         // 材質：光が当たると明暗が出る
  );
  ground.position.y = -0.1;
  compare3d.scene.add(ground);

  // (5) 人（1.7m）：体は円柱、頭は球。小さくても見えるよう赤にする
  const personMaterial = new THREE.MeshLambertMaterial({ color: 0xe53935 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.45, 16), personMaterial);
  body.position.set(-14, 0.725, 4);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), personMaterial);
  head.position.set(-14, 1.57, 4);
  compare3d.scene.add(body, head);

  // (6) 2階建ての家（約6m）と、3階建ての建物（約9m）
  addBuilding(-5, 8, 6, 7, 0xeceff1);
  addBuilding(8, 10, 9, 9, 0xcfd8dc);

  // (7) 水：高さ1mの箱を作り、あとで縦に伸ばして水位を表す
  compare3d.water = new THREE.Mesh(
    new THREE.BoxGeometry(50, 1, 50),
    new THREE.MeshPhongMaterial({ color: 0x2f5f7a, transparent: true, opacity: 0.45, depthWrite: false })
  );
  compare3d.water.visible = false;
  compare3d.scene.add(compare3d.water);

  // (8) 操作と、枠の大きさの変化への対応
  setupCompare3DDrag();
  new ResizeObserver(resizeCompare3D).observe(compare3dBox); // 枠の大きさが変わったら resizeCompare3D を呼ぶ
  resizeCompare3D();

  // (9) 毎コマの描き直しを始める
  compare3d.ready = true;
  requestAnimationFrame(loopCompare3D);
  return true;
}


/* ---------------------------------------------------------
   3. 舞台の部品を作る関数
   --------------------------------------------------------- */

// 建物を1つ置く（x：横の位置、width・depth：幅と奥行き、height：高さ(m)、color：色）
function addBuilding(x, width, height, depth, color) {
  const building = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshLambertMaterial({ color: color })
  );
  building.position.set(x, height / 2, 0); // 箱の中心の高さ＝高さの半分
  compare3d.scene.add(building);

  // 輪郭の線と、3mごとの階の線
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x607d8b });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(building.geometry), lineMaterial);
  edges.position.copy(building.position);
  compare3d.scene.add(edges);
  for (let y = 3; y < height; y += 3) {
    const floor = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 0.01, depth)),
      lineMaterial
    );
    floor.position.set(x, y, 0);
    compare3d.scene.add(floor);
  }
}

// 高さの目盛りの柱：5mごとに赤と白に塗り分ける（市町村が変わるたびに作り直す）
function makePole(maxHeight) {
  if (compare3d.pole) {
    compare3d.scene.remove(compare3d.pole); // 前の柱を片付ける
  }
  compare3d.pole = new THREE.Group(); // Group は部品をまとめて扱う入れもの
  const top = Math.ceil(maxHeight / 5) * 5 + 5; // 津波より少し高くまで
  for (let y = 0; y < top; y += 5) {
    const color = (y / 5) % 2 === 0 ? 0xd32f2f : 0xffffff; // % は割り算の余り。交互に色を変える
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 5, 16),
      new THREE.MeshLambertMaterial({ color: color })
    );
    band.position.set(-20, y + 2.5, 0);
    compare3d.pole.add(band);
  }
  compare3d.scene.add(compare3d.pole);
}


/* ---------------------------------------------------------
   4. 操作：横になぞるとカメラが回る
      pointer… は、指とマウスの両方をまとめて扱えるイベント。
      縦になぞったときは、ブラウザがページをスクロールし、pointercancel が届く。
      （style.css の touch-action: pan-y がその決まり）
   --------------------------------------------------------- */
function setupCompare3DDrag() {
  const canvas = compare3d.renderer.domElement;

  // addEventListener("出来事", 関数) は「その出来事が起きたら、関数を動かす」という予約
  canvas.addEventListener("pointerdown", (e) => {
    compare3d.dragging = true;
    compare3d.lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!compare3d.dragging) return; // なぞっていなければ何もしない
    compare3d.angle -= (e.clientX - compare3d.lastX) * 0.01;
    compare3d.lastX = e.clientX;
  });
  canvas.addEventListener("pointerup", () => {
    compare3d.dragging = false;
  });
  canvas.addEventListener("pointercancel", () => {
    compare3d.dragging = false;
  });
}

// 枠の大きさに、絵とカメラを合わせる
function resizeCompare3D() {
  const width = compare3dBox.clientWidth;
  const height = compare3dBox.clientHeight;
  if (width === 0 || height === 0) return; // 隠れているときは何もしない
  compare3d.renderer.setSize(width, height, false);
  compare3d.camera.aspect = width / height;
  compare3d.camera.updateProjectionMatrix();
}


/* ---------------------------------------------------------
   5. startCompare3D：市町村が選ばれたとき・「もう一度見る」で呼ばれる
   --------------------------------------------------------- */
function startCompare3D(maxHeight) {
  // まだ舞台がなければ作る。作れなかったら（false なら）ここで終わる
  if (!compare3d.ready && !setupCompare3D()) return;
  compare3d.maxHeight = maxHeight;
  compare3d.waterStart = performance.now();
  makePole(maxHeight);
  resizeCompare3D();
}


/* ---------------------------------------------------------
   6. loopCompare3D：毎コマ呼ばれて、絵を描き直す
   --------------------------------------------------------- */
function loopCompare3D(now) {
  requestAnimationFrame(loopCompare3D); // 次のコマも予約しておく
  if (compare3dBox.hidden) return;      // 3Dが隠れているときは描かない（電池の節約）

  // (1) 水位を3秒かけて上げる（平面版と同じ動き）
  const level = compare3d.maxHeight * easeOut(progressOf(compare3d.waterStart, ANIMATION_MS, now));
  compare3d.water.visible = level > 0.01;
  compare3d.water.scale.y = Math.max(level, 0.01); // 高さ1mの箱を level 倍に伸ばす
  compare3d.water.position.y = level / 2;
  waterLevelText.textContent = level.toFixed(1) + "m";

  // (2) なぞっていないときは、ゆっくり自動で回る（動きを減らす設定なら回さない）
  if (!compare3d.dragging && !REDUCE_MOTION) {
    compare3d.angle += 0.002;
  }

  // (3) カメラの位置：津波が高いほど遠く・高くから見る
  //     カメラが水の中に入ると水面が見えなくなるので、必ず水面より上に置く
  const distance = Math.max(60, compare3d.maxHeight * 2.5);
  compare3d.camera.position.set(
    Math.sin(compare3d.angle) * distance,
    compare3d.maxHeight * 1.2 + 12,
    Math.cos(compare3d.angle) * distance
  );
  compare3d.camera.lookAt(0, compare3d.maxHeight * 0.4, 0);

  // (4) 描く
  compare3d.renderer.render(compare3d.scene, compare3d.camera);
}
