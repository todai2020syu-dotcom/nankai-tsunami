// ===== 共通の設定 =====
// 端末で「視差効果を減らす（動きを減らす）」が選ばれていたら true。
// そのときはアニメーションをやめて、最初から最後の状態を見せる
const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ANIMATION_MS = REDUCE_MOTION ? 1 : 3000;

// ===== 3Dの高さくらべ（Three.js を使う） =====
// 長さの単位はすべて「メートル」。1 = 1m として作っている。

const scene3dBox = document.getElementById("scene3d");
const waterLevelText = document.getElementById("water-level-3d");

// 3Dで使う部品をまとめて入れておく箱
const three = {
  ready: false,    // 準備ができたか
  renderer: null,  // 絵を描く係
  scene: null,     // 舞台
  camera: null,    // カメラ
  water: null,     // 水
  maxHeight: 0,    // 今の市町村の最大津波高
  pole: null,      // 高さの目盛りの柱
  waterStart: 0,   // 水が上がり始めた時刻
  angle: 0.6,      // カメラの向き（横方向の角度）
  dragging: false, // 指でなぞっている最中か
  lastX: 0,        // なぞり始めの位置
};

// --- 最初の1回だけ、舞台を組み立てる ---
function setup3D() {
  // Three.js が読み込めていなければ、あきらめて知らせる
  if (typeof THREE === "undefined") {
    waterLevelText.textContent = "3Dを読み込めませんでした";
    return false;
  }

  three.renderer = new THREE.WebGLRenderer({ antialias: true });
  three.renderer.setPixelRatio(window.devicePixelRatio);
  scene3dBox.appendChild(three.renderer.domElement);
  three.renderer.domElement.setAttribute("aria-hidden", "true"); // 説明は外側の枠の aria-label で読み上げる

  three.scene = new THREE.Scene();
  three.scene.background = new THREE.Color(0xdce7ee); // 背景（淡い海の色）
  three.camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 1000);

  // 光（全体を照らす光＋太陽のような光）
  three.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(30, 60, 40);
  three.scene.add(sun);

  // 地面（50m四方）
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(50, 0.2, 50),
    new THREE.MeshLambertMaterial({ color: 0xb0bec5 })
  );
  ground.position.y = -0.1;
  three.scene.add(ground);

  // 人（1.7m）：体は円柱、頭は球
  const personMaterial = new THREE.MeshLambertMaterial({ color: 0xe53935 }); // 小さくても見えるよう赤にする
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.45, 16), personMaterial);
  body.position.set(-14, 0.725, 4);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), personMaterial);
  head.position.set(-14, 1.57, 4);
  three.scene.add(body, head);

  // 2階建ての家（約6m）と、3階建ての建物（約9m）
  addBuilding(-5, 8, 6, 7, 0xeceff1);
  addBuilding(8, 10, 9, 9, 0xcfd8dc);

  // 水：高さ1mの箱を作り、あとで縦に伸ばす
  three.water = new THREE.Mesh(
    new THREE.BoxGeometry(50, 1, 50),
    new THREE.MeshPhongMaterial({ color: 0x2f5f7a, transparent: true, opacity: 0.45, depthWrite: false })
  );
  three.water.visible = false;
  three.scene.add(three.water);

  setupDrag();
  // 枠の大きさが変わったら、絵の大きさも合わせる
  new ResizeObserver(resize3D).observe(scene3dBox);
  resize3D();

  three.ready = true;
  requestAnimationFrame(loop3D);
  return true;
}

// 建物を1つ置く（x：横の位置、width・depth：幅と奥行き、height：高さ）
function addBuilding(x, width, height, depth, color) {
  const building = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshLambertMaterial({ color: color })
  );
  building.position.set(x, height / 2, 0);
  three.scene.add(building);

  // 輪郭の線と、3mごとの階の線
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x607d8b });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(building.geometry), lineMaterial);
  edges.position.copy(building.position);
  three.scene.add(edges);
  for (let y = 3; y < height; y += 3) {
    const floor = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 0.01, depth)),
      lineMaterial
    );
    floor.position.set(x, y, 0);
    three.scene.add(floor);
  }
}

// 高さの目盛りの柱：5mごとに赤と白の色分け（市町村が変わるたびに作り直す）
function makePole(maxHeight) {
  if (three.pole) {
    three.scene.remove(three.pole);
  }
  three.pole = new THREE.Group();
  const top = Math.ceil(maxHeight / 5) * 5 + 5; // 津波より少し高くまで
  for (let y = 0; y < top; y += 5) {
    const color = (y / 5) % 2 === 0 ? 0xd32f2f : 0xffffff;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 5, 16),
      new THREE.MeshLambertMaterial({ color: color })
    );
    band.position.set(-20, y + 2.5, 0);
    three.pole.add(band);
  }
  three.scene.add(three.pole);
}

// 指（マウス）でなぞると、カメラが横に回る
function setupDrag() {
  const canvas = three.renderer.domElement;
  canvas.addEventListener("pointerdown", (e) => {
    three.dragging = true;
    three.lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!three.dragging) return;
    three.angle -= (e.clientX - three.lastX) * 0.01;
    three.lastX = e.clientX;
  });
  canvas.addEventListener("pointerup", () => {
    three.dragging = false;
  });
  // 縦になぞってページのスクロールが始まったら、回転をやめる
  canvas.addEventListener("pointercancel", () => {
    three.dragging = false;
  });
}

// 枠の大きさに合わせる
function resize3D() {
  const width = scene3dBox.clientWidth;
  const height = scene3dBox.clientHeight;
  if (width === 0 || height === 0) return; // 隠れているときは何もしない
  three.renderer.setSize(width, height, false);
  three.camera.aspect = width / height;
  three.camera.updateProjectionMatrix();
}

// --- 市町村が選ばれたとき・「もう一度見る」で呼ばれる ---
function start3D(maxHeight) {
  if (!three.ready && !setup3D()) return;
  three.maxHeight = maxHeight;
  three.waterStart = performance.now();
  makePole(maxHeight);
  resize3D();
}

// --- 毎コマ呼ばれて、絵を描き直す ---
function loop3D(now) {
  requestAnimationFrame(loop3D); // 次のコマも予約しておく
  if (scene3dBox.hidden) return; // 3Dが隠れているときは描かない（電池の節約）

  // 水位を3秒かけて上げる（平面版と同じ動き）
  const progress = Math.max(0, Math.min((now - three.waterStart) / ANIMATION_MS, 1));
  const eased = 1 - Math.pow(1 - progress, 3);
  const level = three.maxHeight * eased;

  three.water.visible = level > 0.01;
  three.water.scale.y = Math.max(level, 0.01);
  three.water.position.y = level / 2;
  waterLevelText.textContent = level.toFixed(1) + "m";

  // なぞっていないときは、ゆっくり自動で回る
  if (!three.dragging && !REDUCE_MOTION) {
    three.angle += 0.002;
  }

  // カメラの位置：津波が高いほど遠く・高くから見る
  // （カメラが水の中に入ると水面が見えなくなるので、必ず水面より上に置く）
  const distance = Math.max(60, three.maxHeight * 2.5);
  three.camera.position.set(
    Math.sin(three.angle) * distance,
    three.maxHeight * 1.2 + 12,
    Math.cos(three.angle) * distance
  );
  three.camera.lookAt(0, three.maxHeight * 0.4, 0);

  three.renderer.render(three.scene, three.camera);
}
