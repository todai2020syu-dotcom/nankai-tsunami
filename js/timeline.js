/* =========================================================
   ファイル：js/timeline.js
   役割　　：「津波が来るまでの時間」のバーを作り、時計を進めるアニメーションをする
   使うHTML：#timeline（バーを入れる場所）、#clock-min（「地震発生から◯分」の数字）

   ほかのファイルとのつながり
     ・main.js から drawTimeline(市町村のデータ) が呼ばれる
     ・common.js の REDUCE_MOTION、progressOf を使う

   ここにあるもの
     1. 使うHTMLの部品
     2. drawTimeline：バーを作ってアニメーションを始める
   ========================================================= */


/* ---------------------------------------------------------
   1. 使うHTMLの部品
   --------------------------------------------------------- */

// document.getElementById("名前") は、HTMLの id="名前" の部品を取り出す命令。
// const は「あとで中身を入れ替えない箱」。
const timelineBox = document.getElementById("timeline");
const clockNumber = document.getElementById("clock-min");

// let は「あとで中身を入れ替える箱」。
// 動いているアニメーションの番号を入れておき、やり直すときに止めるのに使う。
let timelineAnimationId = null;


/* ---------------------------------------------------------
   2. drawTimeline：バーを作ってアニメーションを始める
      m … 1つの市町村のデータ（data.json の1行分）
   --------------------------------------------------------- */
function drawTimeline(m) {
  // (1) 前のアニメーションが動いていたら止めて、前のバーを消す
  if (timelineAnimationId !== null) {
    cancelAnimationFrame(timelineAnimationId);
  }
  timelineBox.innerHTML = "";

  // (2) バーの右端を何分にするか決める（5mの津波より少し先まで見せる。最低10分）
  const timeMax = Math.max(10, Math.ceil((m.arrival5m * 1.25) / 5) * 5);

  // (3) 3つの行のもとになるデータ（[ ] は「配列」＝いくつかの値を順番に並べた入れもの）
  const items = [
    { label: "1mの津波", minutes: m.arrival1m },
    { label: "3mの津波", minutes: m.arrival3m },
    { label: "5mの津波", minutes: m.arrival5m },
  ];

  // (4) 行を作る：「ラベル｜バー｜◯分」
  //     items.map(…) は、配列の1つ1つに同じ処理をして、新しい配列を作る命令。
  //     (item) => { … } は「関数」を短く書く書き方（アロー関数）。
  const rows = items.map((item) => {
    const row = document.createElement("div"); // 新しい <div> を作る
    row.className = "time-row";                // class="time-row" を付ける（見た目は style.css）

    const label = document.createElement("span");
    label.className = "time-label";
    label.textContent = item.label;            // 中の文字を入れる

    const track = document.createElement("div");  // バーの土台
    track.className = "time-track";
    track.setAttribute("aria-hidden", "true");    // 飾りなので、画面読み上げでは読まない

    const fill = document.createElement("div");   // 時間とともに伸びる部分
    fill.className = "time-fill";

    const marker = document.createElement("div"); // 津波が来る時点の印
    marker.className = "time-marker";
    marker.style.left = (item.minutes / timeMax) * 100 + "%";
    track.append(fill, marker);

    const value = document.createElement("span");
    value.className = "time-value";
    value.textContent = item.minutes + "分";

    row.append(label, track, value);
    timelineBox.appendChild(row);              // 画面に追加する

    // あとでアニメーションの中で使う部品を、まとめて返す
    return { row: row, fill: fill, value: value, minutes: item.minutes };
  });

  // (5) アニメーション：0分 → timeMax分 を、4秒かけて進める
  const duration = REDUCE_MOTION ? 1 : 4000;
  const start = performance.now(); // 今の時刻（ミリ秒）

  // frame は「1コマ分の絵を描く」関数。requestAnimationFrame で1秒に約60回呼ばれる
  function frame(now) {
    const progress = progressOf(start, duration, now); // 0〜1
    const minutesNow = timeMax * progress;             // 今、地震から何分たったか

    clockNumber.textContent = Math.floor(minutesNow);  // Math.floor は小数点以下を切り捨て

    rows.forEach((r) => {                               // forEach は配列の1つ1つに処理をする
      r.fill.style.width = progress * 100 + "%";
      // 到達時間を過ぎたら、その行を朱色にし、文字でも「到達」と出す
      if (minutesNow >= r.minutes && !r.row.classList.contains("arrived")) {
        r.row.classList.add("arrived");
        r.value.textContent = "到達 " + r.minutes + "分";
      }
    });

    // まだ終わっていなければ、次のコマを予約する
    if (progress < 1) {
      timelineAnimationId = requestAnimationFrame(frame);
    } else {
      timelineAnimationId = null;
    }
  }
  timelineAnimationId = requestAnimationFrame(frame);
}
