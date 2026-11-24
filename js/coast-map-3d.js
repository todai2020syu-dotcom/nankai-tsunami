/* =========================================================
   ファイル：js/coast-map-3d.js
   役割　　：高知県の3D地図。沿岸の市町村の海岸に、最大津波高を表す「壁」を立てる
   使うHTML：#map3d（地図の枠）、#map-label（選んだ市町村の名前）、#map-info（お知らせ）、
             #map-clock（時間の経過の時計）、#timelapse-text（到達の早い順の文字）
   使う道具：Three.js
   使うデータ：data/map.json（市町村の形と海岸線。tools/make_map.py で作ったもの）

   ほかのファイルとのつながり
     main.js から呼ばれる関数
       ・initCoastMap(市町村の一覧, タップされたときの関数) … 地図を作る
       ・focusCoastMap(市町村名 または null)                … その市町村へ寄る／全体に戻る
       ・startCoastMapTimelapse()                           … 時間の経過を見る
       ・areaLatLng(市町村名)                               … 海岸の真ん中の緯度・経度を返す
     common.js の REDUCE_MOTION、ANIMATION_MS、progressOf、easeOut を使う

   地図の座標のしくみ
     map.json は km 単位の平面。x が東、y が北。
     Three.js では上下が y なので、地図の「北(y)」を3Dの「-z」に置き換えている。
     津波の高さは地図に比べて小さすぎて見えないので、1m を 0.25km（250倍）に強調して壁にする。

   ここにあるもの
     1. 決まりごと（強調の倍率、色、時間の経過の長さ）
     2. 使うHTMLの部品と、地図の部品をまとめる箱（coastMap）
     3. initCoastMap / buildCoastMap：地図を作る
     4. makeWall：海岸線に沿って壁を作る
     5. 操作：なぞると回る・タップで選ぶ
     6. 時間の経過を見る
     7. 市町村に寄る・全体に戻る
     8. loopCoastMap：毎コマ描き直す
   ========================================================= */


/* ---------------------------------------------------------
   1. 決まりごと
   --------------------------------------------------------- */
const WALL_SCALE = 0.25; // 1m を 0.25km の高さの壁にする（250倍）

// 「時間の経過を見る」：15分を10秒に縮めて見せる
const TIMELAPSE_MINUTES = 15;
const TIMELAPSE_SECONDS = 10;

// 壁の色：津波の高さ(m)ごとの5段階。
// 色覚の違いがあっても見分けやすいよう、「明るさ」が段階的に変わる色（高いほど暗い）にしている。
// 区切りは index.html の凡例と同じ。上から順に調べるので、大きい min から並べる。
const HEIGHT_CLASSES = [
  { min: 30, color: 0x993404 }, // 30m以上
  { min: 25, color: 0xd95f0e }, // 25〜30m
  { min: 20, color: 0xfe9929 }, // 20〜25m
  { min: 15, color: 0xfec44f }, // 15〜20m
  { min: 0, color: 0xfee391 },  // 15m未満
];

const LAND_COLOR = 0xe6e0d2;          // 陸地（砂色）
const SELECTED_LAND_COLOR = 0x5b7486; // 選んだ市町村の陸地（灰色がかった青）
const KOCHI_CENTER = { x: 4, z: 18 }; // 高知県の真ん中あたり（全体を見るときにカメラが向く場所）

// 津波の高さから壁の色を決める。find は「条件に合う最初のもの」を探す命令
function heightColor(h) {
  const found = HEIGHT_CLASSES.find((c) => h >= c.min);
  return new THREE.Color(found.color);
}


/* ---------------------------------------------------------
   2. 使うHTMLの部品と、地図の部品をまとめる箱
   --------------------------------------------------------- */
const mapBox = document.getElementById("map3d");
const mapLabel = document.getElementById("map-label");
const mapInfo = document.getElementById("map-info");
const mapClock = document.getElementById("map-clock");

const coastMap = {
  ready: false,          // 地図の準備ができたか
  renderer: null,        // 絵を描く係
  scene: null,           // 舞台
  camera: null,          // カメラ
  areas: [],             // 市町村ごとの部品 { name, land, wall, center, data }
  selected: null,        // 選ばれている市町村（areas の1つ）
  onPick: null,          // 地図をタップしたときに呼ぶ関数（main.js から受け取る）
  wallStart: 0,          // 壁がせり上がり始めた時刻
  angle: 0,              // カメラの横の向き
  target: null,          // カメラが今見ている場所
  goal: null,            // カメラが見たい場所（ここへ少しずつ近づく）
  distance: 300,         // カメラまでの距離（今）
  goalDistance: 300,     // カメラまでの距離（目標）
  pointer: null,         // なぞっている指の情報
  timelapseStart: null,  // 時間の経過を見始めた時刻（見ていないときは null）
};


/* ---------------------------------------------------------
   3. initCoastMap / buildCoastMap：地図を作る
   --------------------------------------------------------- */

// municipalities … data.json の市町村の一覧
// onPick         … 地図で市町村がタップされたときに呼ぶ関数
function initCoastMap(municipalities, onPick) {
  if (typeof THREE === "undefined") {
    mapInfo.textContent = "3D地図を読み込めませんでした";
    return;
  }
  coastMap.onPick = onPick;

  // fetch でファイルを読み、.then で「読めたら次にやること」を順に書く
  fetch("data/map.json")
    .then((response) => response.json()) // 読んだ文字を JSON（データ）に直す
    .then((geo) => {
      buildCoastMap(geo, municipalities);
      coastMap.ready = true;
      coastMap.wallStart = performance.now();
      requestAnimationFrame(loopCoastMap);
    })
    .catch(() => {                        // 途中で失敗したとき
      mapInfo.textContent = "地図のデータを読み込めませんでした";
    });
}

function buildCoastMap(geo, municipalities) {
  // (1) 絵を描く係
  coastMap.renderer = new THREE.WebGLRenderer({ antialias: true });
  coastMap.renderer.setPixelRatio(window.devicePixelRatio);
  mapBox.prepend(coastMap.renderer.domElement);
  describeMapForScreenReader(municipalities);

  // (2) 舞台・カメラ・光
  coastMap.scene = new THREE.Scene();
  coastMap.scene.background = new THREE.Color(0xdce7ee); // 淡い海の色（CSSの --sea-pale と同じ）
  coastMap.camera = new THREE.PerspectiveCamera(40, 4 / 3, 1, 2000);
  coastMap.target = new THREE.Vector3(KOCHI_CENTER.x, 0, KOCHI_CENTER.z);
  coastMap.goal = coastMap.target.clone();

  coastMap.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(-100, 200, 150);
  coastMap.scene.add(sun);

  // (3) 海（大きな板を寝かせる）
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshLambertMaterial({ color: 0xc3d6e2 })
  );
  sea.rotation.x = -Math.PI / 2; // 縦の板を90度倒して、地面と同じ向きにする
  sea.position.y = -0.2;
  coastMap.scene.add(sea);

  // (4) 市町村ごとに「陸地」と「壁」を作る
  const borderMaterial = new THREE.LineBasicMaterial({ color: 0xa89f8a });

  geo.municipalities.forEach((area) => {
    // この市町村の津波のデータ（海に面していない市町村は null）
    const data = municipalities.find((m) => m.name === area.name) || null;

    // 陸地：市町村の形を、厚さ0.5の板にする
    const land = new THREE.Group();
    area.shapes.forEach((rings) => {
      // rings[0] が外側の形、rings[1] 以降は穴（ほかの市町村に囲まれた部分など）
      const shape = new THREE.Shape(rings[0].map((p) => new THREE.Vector2(p[0], p[1])));
      rings.slice(1).forEach((hole) => {
        shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p[0], p[1]))));
      });
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2); // 平面の地図を地面に寝かせる
      land.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: LAND_COLOR })));
      land.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), borderMaterial)); // 境目の線
    });
    coastMap.scene.add(land);

    // 壁：海岸がある市町村だけ
    let wall = null;
    if (data && area.coast.length > 0) {
      wall = makeWall(area.coast, data.maxHeight * WALL_SCALE, heightColor(data.maxHeight));
      wall.position.y = 0.5; // 陸地の板の上から立てる
      coastMap.scene.add(wall);
    }

    // 名前を出す位置：海岸があれば海岸の真ん中、なければ形の真ん中
    // reduce は配列の値を1つにまとめる命令（ここでは合計を出している）
    const points = area.coast.length > 0 ? area.coast.flat() : area.shapes[0][0];
    const center = new THREE.Vector3(
      points.reduce((sum, p) => sum + p[0], 0) / points.length,
      0,
      -points.reduce((sum, p) => sum + p[1], 0) / points.length
    );

    coastMap.areas.push({ name: area.name, land: land, wall: wall, center: center, data: data });
  });

  // (5) 操作と、枠の大きさの変化への対応
  setupCoastMapPointer();
  new ResizeObserver(resizeCoastMap).observe(mapBox);
  resizeCoastMap();
}

// 画面読み上げ用：地図の絵に説明文を付ける（数字はデータから作る）
function describeMapForScreenReader(municipalities) {
  // slice() で元の並びを崩さないようにコピーしてから、高い順に並べかえる
  const sorted = municipalities.slice().sort((a, b) => b.maxHeight - a.maxHeight);
  const highest = sorted.filter((m) => m.maxHeight === sorted[0].maxHeight).map((m) => m.name).join("と");
  const lowest = sorted[sorted.length - 1];
  const canvas = coastMap.renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "高知県の3D地図。沿岸の" + municipalities.length + "市町村の海岸に、最大津波高を表す壁を立てています。" +
      "最も高いのは" + highest + "の" + sorted[0].maxHeight + "メートル、最も低いのは" +
      lowest.name + "などの" + lowest.maxHeight + "メートルです。" +
      "市町村ごとの数字は、地図の下の表で確認できます。"
  );
}


/* ---------------------------------------------------------
   4. makeWall：海岸線に沿って、縦の壁を作る
      lines … 海岸線（点の並び）のリスト、height … 壁の高さ、color … 色
      線の1区間ごとに「四角形」を作る。3Dでは四角形を三角形2つで表す。
   --------------------------------------------------------- */
function makeWall(lines, height, color) {
  const positions = []; // 三角形の頂点の座標を、x, y, z の順にどんどん入れていく
  lines.forEach((line) => {
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, y1] = line[i];     // [a, b] = 配列 で、中身を2つの箱に分けて入れる
      const [x2, y2] = line[i + 1];
      const a = [x1, 0, -y1];       // 下の2点
      const b = [x2, 0, -y2];
      const c = [x2, height, -y2];  // 上の2点
      const d = [x1, height, -y1];
      positions.push(...a, ...b, ...c, ...a, ...c, ...d); // 三角形 a-b-c と a-c-d（... は中身を広げる記号）
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); // 光の当たり方を計算するための向き

  const wall = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color: color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
  );

  // 壁の上のふちに墨色の線を引く（薄い黄色の壁でも、陸地と見分けられるように）
  const topLineMaterial = new THREE.LineBasicMaterial({ color: 0x1f2a33 });
  lines.forEach((line) => {
    const points = line.map(([x, y]) => new THREE.Vector3(x, height, -y));
    wall.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), topLineMaterial));
  });
  return wall;
}


/* ---------------------------------------------------------
   5. 操作：横になぞると回る。軽くタップすると、その市町村を選ぶ
   --------------------------------------------------------- */
function setupCoastMapPointer() {
  const canvas = coastMap.renderer.domElement;

  canvas.addEventListener("pointerdown", (e) => {
    coastMap.pointer = { x: e.clientX, y: e.clientY, lastX: e.clientX, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!coastMap.pointer) return;
    coastMap.angle -= (e.clientX - coastMap.pointer.lastX) * 0.01;
    coastMap.pointer.lastX = e.clientX;
    // 6px より動いたら「なぞった」とみなす（タップではない）
    if (Math.abs(e.clientX - coastMap.pointer.x) + Math.abs(e.clientY - coastMap.pointer.y) > 6) {
      coastMap.pointer.moved = true;
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (coastMap.pointer && !coastMap.pointer.moved) {
      pickAt(e.clientX, e.clientY); // ほとんど動いていなければタップ
    }
    coastMap.pointer = null;
  });
  // 縦になぞってページのスクロールが始まると、ここが呼ばれる（回転をやめる）
  canvas.addEventListener("pointercancel", () => {
    coastMap.pointer = null;
  });
}

// タップした場所にある市町村を探す
function pickAt(clientX, clientY) {
  // (1) タップした位置を、-1〜1 の範囲の座標に直す（Three.js の決まり）
  const rect = coastMap.renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  // (2) カメラからその方向に「見えない線」を飛ばし、当たった物を調べる（Raycaster）
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, coastMap.camera);
  // 境目の線ではなく、陸地の板（Mesh）に当たったものを選ぶ
  const hit = raycaster
    .intersectObjects(coastMap.areas.map((a) => a.land), true)
    .find((h) => h.object.isMesh);
  if (!hit) return;

  // (3) 当たった板がどの市町村のものかを探す
  const area = coastMap.areas.find((a) => a.land === hit.object.parent);
  if (area.data) {
    coastMap.onPick(area.name); // main.js に知らせて、結果を表示してもらう
  } else {
    focusCoastMap(null);
    mapInfo.textContent = area.name + "：海に面していないため、この資料に津波のデータはありません";
  }
}

// 枠の大きさに、絵とカメラを合わせる
function resizeCoastMap() {
  const width = mapBox.clientWidth;
  const height = mapBox.clientHeight;
  if (width === 0 || height === 0) return;
  coastMap.renderer.setSize(width, height, false);
  coastMap.camera.aspect = width / height;
  coastMap.camera.updateProjectionMatrix();
}


/* ---------------------------------------------------------
   6. 時間の経過を見る：1mの津波が来る順に壁を立てる
   --------------------------------------------------------- */
function startCoastMapTimelapse() {
  if (!coastMap.ready) return;
  focusCoastMap(null); // 全体を見る
  // 動きを減らす設定のときは、最初から15分後（すべて到達した状態）を見せる
  coastMap.timelapseStart = REDUCE_MOTION
    ? performance.now() - TIMELAPSE_SECONDS * 1000
    : performance.now();
  mapClock.hidden = false;
  showArrivalOrder();
}

// 1mの津波が早く来る順を、文字でも示す（動きが見えない人・読み上げのため）
//   例：「3分：室戸市、安芸郡東洋町／4分：土佐清水市／…」
function showArrivalOrder() {
  const byMinute = {}; // { 3: ["室戸市", …], 4: [...] } のように、分ごとに名前を集める
  coastMap.areas.forEach((a) => {
    if (!a.data) return;
    const min = a.data.arrival1m;
    if (!byMinute[min]) byMinute[min] = [];
    byMinute[min].push(a.name);
  });
  const parts = Object.keys(byMinute) // Object.keys は「名前の一覧」を取り出す
    .map(Number)                      // 文字の "3" を数の 3 に直す
    .sort((x, y) => x - y)            // 小さい順に並べる
    .map((min) => min + "分：" + byMinute[min].join("、"));
  const text = document.getElementById("timelapse-text");
  text.textContent = "1mの津波が早く来る順（11通りの想定の最短）　" + parts.join("／");
  text.hidden = false;
}


/* ---------------------------------------------------------
   7. 市町村に寄る・全体に戻る
   --------------------------------------------------------- */

// name に市町村名を渡すとそこへ寄る。null を渡すと全体に戻る
function focusCoastMap(name) {
  if (!coastMap.ready) return;
  coastMap.timelapseStart = null; // 時間の経過の表示はやめる
  mapClock.hidden = true;
  coastMap.selected = coastMap.areas.find((a) => a.name === name) || null;
  mapInfo.textContent = "";

  // 選んだ市町村の陸地の色を変え、ほかの市町村の壁は薄くする
  coastMap.areas.forEach((a) => {
    const isSelected = a === coastMap.selected;
    a.land.children.forEach((child) => {
      if (child.isMesh) child.material.color.set(isSelected ? SELECTED_LAND_COLOR : LAND_COLOR);
    });
    if (a.wall) {
      a.wall.material.opacity = coastMap.selected && !isSelected ? 0.3 : 0.85;
    }
  });

  // カメラの目標を決める（実際の移動は loopCoastMap で少しずつ行う）
  if (coastMap.selected) {
    coastMap.goal.copy(coastMap.selected.center);
    coastMap.goalDistance = 120;
  } else {
    coastMap.goal.set(KOCHI_CENTER.x, 0, KOCHI_CENTER.z);
    coastMap.goalDistance = 300;
  }
  coastMap.wallStart = performance.now(); // 壁をもう一度せり上げる
}

// 市町村の名前から、その海岸の真ん中の緯度・経度を出す（2Dの地図 hazard-map.js で使う）
// map.json は km 単位の平面なので、作ったときの式（tools/make_map.py）を逆にたどる
function areaLatLng(name) {
  const area = coastMap.areas.find((a) => a.name === name);
  if (!area) return null;
  const LON0 = 133.35; // tools/make_map.py の LON0 と同じ
  const LAT0 = 33.45;  // tools/make_map.py の LAT0 と同じ
  return {
    lat: -area.center.z / 110.57 + LAT0,
    lng: area.center.x / (Math.cos((LAT0 * Math.PI) / 180) * 111.32) + LON0,
  };
}


/* ---------------------------------------------------------
   8. loopCoastMap：毎コマ呼ばれて、絵を描き直す
   --------------------------------------------------------- */
function loopCoastMap(now) {
  requestAnimationFrame(loopCoastMap); // 次のコマも予約しておく

  const eased = easeOut(progressOf(coastMap.wallStart, ANIMATION_MS, now)); // 壁のせり上がり具合 0〜1

  // (1) 壁の高さ
  if (coastMap.timelapseStart !== null) {
    // 時間の経過：今が地震から何分かを計算し、到達時間を過ぎた市町村の壁を立てる
    const seconds = (now - coastMap.timelapseStart) / 1000;
    const minutes = Math.min((seconds / TIMELAPSE_SECONDS) * TIMELAPSE_MINUTES, TIMELAPSE_MINUTES);
    mapClock.textContent = "地震発生から " + Math.floor(minutes) + "分";
    coastMap.areas.forEach((a) => {
      if (!a.wall) return;
      const rise = Math.max(0, Math.min(minutes - a.data.arrival1m, 1)); // 到達してから1分かけて立つ
      a.wall.scale.y = Math.max(rise, 0.001);
    });
  } else {
    coastMap.areas.forEach((a) => {
      if (!a.wall) return;
      // 選んでいるときは、その市町村の壁だけ動かす
      const animate = !coastMap.selected || a === coastMap.selected;
      a.wall.scale.y = animate ? Math.max(eased, 0.001) : 1;
    });
  }

  // (2) なぞっていないときは、ゆっくり回る（動きを減らす設定なら回さない）
  if (!coastMap.pointer && !REDUCE_MOTION) coastMap.angle += 0.0015;

  // (3) カメラを目標に少しずつ近づける（毎コマ6%ずつ。なめらかに移動するため）
  coastMap.target.lerp(coastMap.goal, 0.06);
  coastMap.distance += (coastMap.goalDistance - coastMap.distance) * 0.06;

  // (4) 斜め上から見下ろす位置にカメラを置く
  const tilt = 0.8; // 真上からの傾き（ラジアン。0なら真上から）
  coastMap.camera.position.set(
    coastMap.target.x + Math.sin(coastMap.angle) * Math.sin(tilt) * coastMap.distance,
    coastMap.target.y + Math.cos(tilt) * coastMap.distance,
    coastMap.target.z + Math.cos(coastMap.angle) * Math.sin(tilt) * coastMap.distance
  );
  coastMap.camera.lookAt(coastMap.target);
  coastMap.renderer.render(coastMap.scene, coastMap.camera);

  // (5) 選んだ市町村の名前と高さを、壁の上に表示する
  if (coastMap.selected) {
    const h = coastMap.selected.data.maxHeight;
    const top = coastMap.selected.center.clone();
    top.y = h * WALL_SCALE * eased + 1;
    top.project(coastMap.camera); // 3Dの位置を、画面上の位置（-1〜1）に変える
    mapLabel.style.left = ((top.x + 1) / 2) * mapBox.clientWidth + "px";
    mapLabel.style.top = ((1 - top.y) / 2) * mapBox.clientHeight + "px";
    mapLabel.textContent = coastMap.selected.name + " " + Math.round(h * eased) + "m";
    mapLabel.hidden = false;
  } else {
    mapLabel.hidden = true;
  }
}
