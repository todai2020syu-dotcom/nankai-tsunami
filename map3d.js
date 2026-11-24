// ===== 高知県の3D地図：海岸に津波の壁を立てる =====
// 地図の長さの単位は km。x が東、-z が北（Three.js では上が y）。
// 津波の高さは、そのままだと地図に比べて小さすぎて見えないので、
// 1m を 0.25km（250倍）に強調して壁にする。
const WALL_SCALE = 0.25;

const mapBox = document.getElementById("map3d");
const mapLabel = document.getElementById("map-label");
const mapInfo = document.getElementById("map-info");
const mapClock = document.getElementById("map-clock");

// 「時間の経過を見る」：15分を10秒に縮めて見せる
const TIMELAPSE_MINUTES = 15;
const TIMELAPSE_SECONDS = 10;

const map = {
  ready: false,
  renderer: null,
  scene: null,
  camera: null,
  areas: [],        // 市町村ごとの部品 { name, land, wall, center, data }
  selected: null,   // 選ばれている市町村
  onPick: null,     // 地図をタップしたときに呼ぶ関数
  wallStart: 0,     // 壁がせり上がり始めた時刻
  angle: 0,         // カメラの横の角度
  target: null,     // カメラが見ている場所（今）
  goal: null,       // カメラが見たい場所（目標）
  distance: 300,
  goalDistance: 300,
  pointer: null,    // なぞり始めの位置
  timelapseStart: null, // 時間の経過を見ているときの開始時刻（見ていないときは null）
};

// 津波の高さ（m）から壁の色を決める
// 色覚の違いがあっても見分けやすいよう、色みではなく「明るさ」が段階的に変わる5色にしている
// （薄い黄 → 橙 → こげ茶。高いほど暗い）。区切りは凡例（index.html）と同じ
const HEIGHT_CLASSES = [
  { min: 30, color: 0x993404 }, // 30m以上
  { min: 25, color: 0xd95f0e }, // 25〜30m
  { min: 20, color: 0xfe9929 }, // 20〜25m
  { min: 15, color: 0xfec44f }, // 15〜20m
  { min: 0, color: 0xfee391 },  // 15m未満
];

// 陸地の色（砂色）と、選んだ市町村の陸地の色（灰色がかった青）
const LAND_COLOR = 0xe6e0d2;
const SELECTED_LAND_COLOR = 0x5b7486;

function heightColor(h) {
  const found = HEIGHT_CLASSES.find((c) => h >= c.min);
  return new THREE.Color(found.color);
}

// --- 地図を作る（data.json を読んだあとに1回呼ぶ） ---
function initMap(municipalities, onPick) {
  if (typeof THREE === "undefined") {
    mapInfo.textContent = "3D地図を読み込めませんでした";
    return;
  }
  map.onPick = onPick;

  fetch("map.json")
    .then((response) => response.json())
    .then((geo) => {
      buildMap(geo, municipalities);
      map.ready = true;
      map.wallStart = performance.now();
      requestAnimationFrame(loopMap);
    })
    .catch(() => {
      mapInfo.textContent = "地図のデータを読み込めませんでした";
    });
}

function buildMap(geo, municipalities) {
  map.renderer = new THREE.WebGLRenderer({ antialias: true });
  map.renderer.setPixelRatio(window.devicePixelRatio);
  mapBox.prepend(map.renderer.domElement);
  // 画面読み上げ用：地図の絵に説明を付ける（数字はデータから作る）
  const sorted = municipalities.slice().sort((a, b) => b.maxHeight - a.maxHeight);
  const highest = sorted.filter((m) => m.maxHeight === sorted[0].maxHeight).map((m) => m.name).join("と");
  const lowest = sorted[sorted.length - 1];
  map.renderer.domElement.setAttribute("role", "img");
  map.renderer.domElement.setAttribute(
    "aria-label",
    "高知県の3D地図。沿岸の" + municipalities.length + "市町村の海岸に、最大津波高を表す壁を立てています。" +
      "最も高いのは" + highest + "の" + sorted[0].maxHeight + "メートル、最も低いのは" +
      lowest.name + "などの" + lowest.maxHeight + "メートルです。" +
      "市町村ごとの数字は、地図の下の表で確認できます。"
  );

  map.scene = new THREE.Scene();
  map.scene.background = new THREE.Color(0xdce7ee); // 淡い海の色（CSSの --sea-pale と同じ）
  map.camera = new THREE.PerspectiveCamera(40, 4 / 3, 1, 2000);
  map.target = new THREE.Vector3(4, 0, 18); // 高知県の真ん中あたり
  map.goal = map.target.clone();

  map.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(-100, 200, 150);
  map.scene.add(sun);

  // 海
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshLambertMaterial({ color: 0xc3d6e2 })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.2;
  map.scene.add(sea);

  const borderMaterial = new THREE.LineBasicMaterial({ color: 0xa89f8a });

  geo.municipalities.forEach((area) => {
    const data = municipalities.find((m) => m.name === area.name) || null;

    // 陸地（市町村の形を少しだけ厚みのある板にする）
    const geometries = area.shapes.map((rings) => {
      const shape = new THREE.Shape(rings[0].map((p) => new THREE.Vector2(p[0], p[1])));
      rings.slice(1).forEach((hole) => {
        shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p[0], p[1]))));
      });
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
      g.rotateX(-Math.PI / 2); // 平面の地図を、地面に寝かせる
      return g;
    });
    const land = new THREE.Group();
    geometries.forEach((g) => {
      land.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: LAND_COLOR })));
      // 市町村の境目の線
      const border = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), borderMaterial);
      land.add(border);
    });
    map.scene.add(land);

    // 海岸に立てる津波の壁
    let wall = null;
    if (data && area.coast.length > 0) {
      wall = makeWall(area.coast, data.maxHeight * WALL_SCALE, heightColor(data.maxHeight));
      wall.position.y = 0.5; // 陸地の板の上から立てる
      map.scene.add(wall);
    }

    // 名前を出す位置（海岸があれば海岸の真ん中、なければ形の真ん中）
    const points = area.coast.length > 0 ? area.coast.flat() : area.shapes[0][0];
    const center = new THREE.Vector3(
      points.reduce((s, p) => s + p[0], 0) / points.length,
      0,
      -points.reduce((s, p) => s + p[1], 0) / points.length
    );

    map.areas.push({ name: area.name, land, wall, center, data });
  });

  setupMapPointer();
  document.getElementById("map-time").addEventListener("click", startTimelapse);
  new ResizeObserver(resizeMap).observe(mapBox);
  resizeMap();
}

// 海岸線に沿って、縦の壁を作る（線の1区間ごとに四角形を2つの三角形で作る）
function makeWall(lines, height, color) {
  const positions = [];
  lines.forEach((line) => {
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, y1] = line[i];
      const [x2, y2] = line[i + 1];
      const a = [x1, 0, -y1], b = [x2, 0, -y2];          // 下の2点
      const c = [x2, height, -y2], d = [x1, height, -y1]; // 上の2点
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshLambertMaterial({
    color: color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  const wall = new THREE.Mesh(geometry, material);

  // 壁の上のふちに墨色の線を引く（薄い黄色の壁でも、陸地と見分けられるように）
  const topLine = new THREE.LineBasicMaterial({ color: 0x1f2a33 });
  lines.forEach((line) => {
    const points = line.map(([x, y]) => new THREE.Vector3(x, height, -y));
    wall.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), topLine));
  });
  return wall;
}

// --- 指でなぞると回る。軽くタップすると、その市町村を選ぶ ---
function setupMapPointer() {
  const canvas = map.renderer.domElement;
  canvas.addEventListener("pointerdown", (e) => {
    map.pointer = { x: e.clientX, y: e.clientY, lastX: e.clientX, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!map.pointer) return;
    map.angle -= (e.clientX - map.pointer.lastX) * 0.01;
    map.pointer.lastX = e.clientX;
    if (Math.abs(e.clientX - map.pointer.x) + Math.abs(e.clientY - map.pointer.y) > 6) {
      map.pointer.moved = true;
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (map.pointer && !map.pointer.moved) {
      pickAt(e.clientX, e.clientY);
    }
    map.pointer = null;
  });
  // 縦になぞってページのスクロールが始まると、ここが呼ばれる（回転をやめる）
  canvas.addEventListener("pointercancel", () => {
    map.pointer = null;
  });
}

// タップした場所にある市町村を探す
function pickAt(clientX, clientY) {
  const rect = map.renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, map.camera);
  // 境目の線ではなく、陸地の板に当たったものを探す
  const hit = raycaster
    .intersectObjects(map.areas.map((a) => a.land), true)
    .find((h) => h.object.isMesh);
  if (!hit) return;

  const area = map.areas.find((a) => a.land === hit.object.parent);
  if (area.data) {
    map.onPick(area.name); // script.js に知らせて、結果を表示してもらう
  } else {
    focusMap(null);
    mapInfo.textContent = area.name + "：海に面していないため、この資料に津波のデータはありません";
  }
}

// --- 時間の経過を見る（全体を見ながら、到達時間の順に壁を立てる） ---
function startTimelapse() {
  if (!map.ready) return;
  focusMap(null);
  // 動きを減らす設定のときは、最初から15分後（すべて到達した状態）を見せる
  map.timelapseStart = REDUCE_MOTION
    ? performance.now() - TIMELAPSE_SECONDS * 1000
    : performance.now();
  mapClock.hidden = false;
  showArrivalOrder();
}

// 1mの津波が早く来る順を、文字でも示す（動きが見えない人・読み上げのため）
function showArrivalOrder() {
  const byMinute = {};
  map.areas.forEach((a) => {
    if (!a.data) return;
    (byMinute[a.data.arrival1m] = byMinute[a.data.arrival1m] || []).push(a.name);
  });
  const parts = Object.keys(byMinute)
    .map(Number)
    .sort((x, y) => x - y)
    .map((min) => min + "分：" + byMinute[min].join("、"));
  const text = document.getElementById("timelapse-text");
  text.textContent = "1mの津波が早く来る順（11通りの想定の最短）　" + parts.join("／");
  text.hidden = false;
}

// --- 市町村を選んだとき（script.js から呼ばれる）。null なら全体を見る ---
function focusMap(name) {
  if (!map.ready) return;
  map.timelapseStart = null; // 時間の経過の表示はやめる
  mapClock.hidden = true;
  map.selected = map.areas.find((a) => a.name === name) || null;
  mapInfo.textContent = "";

  map.areas.forEach((a) => {
    const isSelected = a === map.selected;
    a.land.children.forEach((child) => {
      if (child.isMesh) child.material.color.set(isSelected ? SELECTED_LAND_COLOR : LAND_COLOR);
    });
    if (a.wall) {
      // 選んだ市町村の壁ははっきり、ほかは薄くする
      a.wall.material.opacity = map.selected && !isSelected ? 0.3 : 0.85;
    }
  });

  if (map.selected) {
    map.goal.copy(map.selected.center);
    map.goalDistance = 120;
  } else {
    map.goal.set(4, 0, 18);
    map.goalDistance = 300;
  }
  map.wallStart = performance.now(); // 壁をもう一度せり上げる
}

function resizeMap() {
  const width = mapBox.clientWidth;
  const height = mapBox.clientHeight;
  if (width === 0 || height === 0) return;
  map.renderer.setSize(width, height, false);
  map.camera.aspect = width / height;
  map.camera.updateProjectionMatrix();
}

// --- 毎コマ呼ばれて、絵を描き直す ---
function loopMap(now) {
  requestAnimationFrame(loopMap);

  // 壁を3秒かけてせり上げる
  const progress = Math.max(0, Math.min((now - map.wallStart) / ANIMATION_MS, 1));
  const eased = 1 - Math.pow(1 - progress, 3);
  if (map.timelapseStart !== null) {
    // 時間の経過：今が地震から何分かを計算し、到達時間を過ぎた市町村の壁を立てる
    const seconds = (now - map.timelapseStart) / 1000;
    const minutes = Math.min((seconds / TIMELAPSE_SECONDS) * TIMELAPSE_MINUTES, TIMELAPSE_MINUTES);
    mapClock.textContent = "地震発生から " + Math.floor(minutes) + "分";
    map.areas.forEach((a) => {
      if (!a.wall) return;
      // 到達してから1分かけて立ち上がる
      const rise = Math.max(0, Math.min(minutes - a.data.arrival1m, 1));
      a.wall.scale.y = Math.max(rise, 0.001);
    });
  } else {
    map.areas.forEach((a) => {
      if (!a.wall) return;
      // 選んでいるときは、その市町村の壁だけ動かす
      const animate = !map.selected || a === map.selected;
      a.wall.scale.y = animate ? Math.max(eased, 0.001) : 1;
    });
  }

  // なぞっていないときは、ゆっくり回る
  if (!map.pointer && !REDUCE_MOTION) map.angle += 0.0015;

  // カメラを目標に少しずつ近づける（なめらかに移動するため）
  map.target.lerp(map.goal, 0.06);
  map.distance += (map.goalDistance - map.distance) * 0.06;

  // 斜め上（約50度）から見下ろす
  const tilt = 0.8; // 真上からの傾き（ラジアン。0なら真上）
  map.camera.position.set(
    map.target.x + Math.sin(map.angle) * Math.sin(tilt) * map.distance,
    map.target.y + Math.cos(tilt) * map.distance,
    map.target.z + Math.cos(map.angle) * Math.sin(tilt) * map.distance
  );
  map.camera.lookAt(map.target);
  map.renderer.render(map.scene, map.camera);

  // 選んだ市町村の名前と高さを、壁の上に表示する
  if (map.selected) {
    const h = map.selected.data.maxHeight;
    const top = map.selected.center.clone();
    top.y = h * WALL_SCALE * eased + 1;
    top.project(map.camera); // 3Dの位置を、画面上の位置に変える
    mapLabel.style.left = ((top.x + 1) / 2) * mapBox.clientWidth + "px";
    mapLabel.style.top = ((1 - top.y) / 2) * mapBox.clientHeight + "px";
    mapLabel.textContent = map.selected.name + " " + Math.round(h * eased) + "m";
    mapLabel.hidden = false;
  } else {
    mapLabel.hidden = true;
  }
}
