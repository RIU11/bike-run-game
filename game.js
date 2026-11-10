(function () {
  "use strict";
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("bikerun:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("bikerun:" + k, JSON.stringify(v)); } catch (e) { /* 保存できない環境では無視 */ } }
  };

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);

  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);

  /* ---------- 定数 ---------- */
  var FOCAL = 52;            // 小さいほど遠近感が強い
  var ROAD_HALF = 3;         // 道の半幅（ワールド単位）
  var SIDEWALK_W = 0.6;      // 歩道の幅（ワールド単位）
  var LANES = [-1.8, 0, 1.8];
  var SPAWN_AHEAD = 140;     // 新しい障害物を置く、プレイヤーから見た先の距離
  var BASE_INTERVAL = 46, MIN_INTERVAL = 26, INTERVAL_K = 0.9;
  var SPEED_START = 10, SPEED_MAX = 85, ACCEL_K = 0.012; // 指数的に最高速へ近づく＝後半ほど速くなる
  var LIVES_START = 3;
  var HIT_WINDOW = 1.1;      // この距離差の間だけ当たり判定を見る
  var INVINCIBLE_SEC = 1.2;
  var PLAYER_RADIUS = 0.55, OBSTACLE_RADIUS = 0.6;
  var BUILDING_INTERVAL = 11;
  var CITY_COLORS = ["#525c70", "#5a6478", "#6b5b53", "#4f6168", "#565a72", "#47536a", "#5f5248"];

  var PERSP_K = 0.27;
  function perspX(worldX, aheadZ) {
    var scale = FOCAL / (aheadZ + FOCAL);
    return { x: W / 2 + worldX * scale * (W * PERSP_K), scale: scale };
  }
  function groundY(scale) {
    var horizon = H * 0.38;
    return horizon + scale * (H - horizon);
  }

  /* ---------- 状態 ---------- */
  var state = "ready"; // ready | playing | over
  var playerZ = 0, speed = SPEED_START, playTime = 0;
  var playerX = 0, targetX = 0, dragging = false;
  var lives = LIVES_START, invTimer = 0;
  var pedalPhase = 0;
  var obstacles = []; // {z, lane}
  var nextSpawnZ = SPAWN_AHEAD;
  var buildings = []; // {z, side, height, width, color}
  var nextBuildingZ = 10;
  var best = store.get("best", 0);

  function resetGame() {
    state = "playing";
    playerZ = 0; speed = SPEED_START; playTime = 0;
    playerX = 0; targetX = 0;
    lives = LIVES_START; invTimer = 0;
    obstacles = []; nextSpawnZ = SPAWN_AHEAD;
    buildings = []; nextBuildingZ = 10;
    renderLives();
    document.getElementById("over").hidden = true;
    document.getElementById("ready").hidden = true;
  }

  function renderLives() {
    var el = document.getElementById("lives"); el.innerHTML = "";
    for (var i = 0; i < LIVES_START; i++) {
      var d = document.createElement("div");
      d.className = "life" + (i >= lives ? " lost" : "");
      el.appendChild(d);
    }
  }

  function spawnIfNeeded() {
    while (nextSpawnZ < playerZ + SPAWN_AHEAD + 20) {
      var blockCount = Math.random() < 0.6 ? 1 : 2;
      var lanesCopy = LANES.slice();
      var blocked = [];
      for (var i = 0; i < blockCount && lanesCopy.length > 1; i++) {
        var idx = Math.floor(Math.random() * lanesCopy.length);
        blocked.push(lanesCopy.splice(idx, 1)[0]);
      }
      blocked.forEach(function (lane) { obstacles.push({ z: nextSpawnZ, lane: lane, hit: false }); });
      var interval = Math.max(MIN_INTERVAL, BASE_INTERVAL - speed * INTERVAL_K);
      nextSpawnZ += interval;
    }
  }

  function spawnBuildingsIfNeeded() {
    while (nextBuildingZ < playerZ + SPAWN_AHEAD + 40) {
      [-1, 1].forEach(function (side) {
        buildings.push({
          z: nextBuildingZ + (Math.random() * 6 - 3),
          side: side,
          height: 5 + Math.random() * 16,
          width: 1.6 + Math.random() * 1.4,
          color: CITY_COLORS[Math.floor(Math.random() * CITY_COLORS.length)]
        });
      });
      nextBuildingZ += BUILDING_INTERVAL;
    }
  }

  function update(dt) {
    if (state !== "playing") return;
    playTime += dt;
    speed = SPEED_MAX - (SPEED_MAX - SPEED_START) * Math.exp(-ACCEL_K * playTime);
    playerZ += speed * dt;
    pedalPhase += speed * dt * 2.6;
    playerX = targetX;
    if (invTimer > 0) invTimer -= dt;

    spawnIfNeeded();
    spawnBuildingsIfNeeded();
    obstacles = obstacles.filter(function (o) { return o.z > playerZ - 6; });
    buildings = buildings.filter(function (b) { return b.z > playerZ - 20; });

    if (invTimer <= 0) {
      for (var i = 0; i < obstacles.length; i++) {
        var o = obstacles[i];
        if (o.hit) continue;
        var rel = o.z - playerZ;
        if (rel >= -0.5 && rel <= HIT_WINDOW) {
          if (Math.abs(o.lane - playerX) < (PLAYER_RADIUS + OBSTACLE_RADIUS)) {
            o.hit = true;
            lives--;
            invTimer = INVINCIBLE_SEC;
            renderLives();
            if (lives <= 0) { gameOver(); return; }
          }
        }
      }
    }
  }

  function gameOver() {
    state = "over";
    var dist = Math.floor(playerZ);
    if (dist > best) { best = dist; store.set("best", best); }
    document.getElementById("dist-final").textContent = dist;
    document.getElementById("best-final").textContent = best;
    document.getElementById("over").hidden = false;
  }

  /* ---------- 描画 ---------- */
  var SKYLINE = (function () {
    var arr = [];
    for (var i = 0; i < 16; i++) arr.push({ x: i / 16, w: 0.5 + Math.random() * 0.9, h: 0.25 + Math.random() * 0.55 });
    return arr;
  })();

  function drawSky() {
    var horizonY = H * 0.38;
    var grad = ctx.createLinearGradient(0, 0, 0, horizonY);
    grad.addColorStop(0, "#0e1830"); grad.addColorStop(1, "#30507e");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, horizonY);

    // 地面側のベース塗り（毎フレームの下地。これより後に建物・道を上から重ねて描く）
    ctx.fillStyle = "#23262f";
    ctx.fillRect(0, horizonY, W, H - horizonY);

    // 遠くの街並みのシルエット（ゆっくり流れる）
    var shift = (playerZ * 0.003) % 1;
    ctx.fillStyle = "rgba(10,16,32,.55)";
    SKYLINE.forEach(function (b) {
      var x = ((b.x - shift) % 1 + 1) % 1;
      var bw = b.w * (W / 10);
      var bh = b.h * horizonY * 0.6;
      ctx.fillRect(x * W - bw / 2, horizonY - bh, bw, bh);
      if (x * W - bw / 2 + bw > W) ctx.fillRect(x * W - bw / 2 - W, horizonY - bh, bw, bh);
    });
  }

  function drawBuildings() {
    var sorted = buildings.slice().sort(function (a, b) { return b.z - a.z; });
    var k = W * PERSP_K;
    sorted.forEach(function (b) {
      var rel = b.z - playerZ;
      if (rel < -15 || rel > SPAWN_AHEAD + 60) return;
      var baseX = ROAD_HALF + SIDEWALK_W;
      var centerWorldX = b.side * (baseX + b.width / 2);
      var p = perspX(centerWorldX, Math.max(rel, 0.01));
      var scaleW = b.width * p.scale * k;
      if (scaleW < 1.5) return;
      var y0 = groundY(p.scale);
      var topY = y0 - b.height * p.scale * k * 0.55;
      ctx.fillStyle = b.color;
      ctx.fillRect(p.x - scaleW / 2, topY, scaleW, y0 - topY);
      if (scaleW > 16) {
        var rows = Math.max(1, Math.round((y0 - topY) / (scaleW * 0.4)));
        var cols = Math.max(1, Math.round(scaleW / (scaleW * 0.35)));
        ctx.fillStyle = "rgba(255,230,160,.35)";
        for (var r = 0; r < rows; r++) {
          for (var c = 0; c < cols; c++) {
            var wx = p.x - scaleW / 2 + scaleW * (0.18 + c * 0.64 / Math.max(1, cols - 1 || 1));
            var wy = topY + (y0 - topY) * (0.15 + r * 0.7 / Math.max(1, rows - 1 || 1));
            ctx.fillRect(wx, wy, scaleW * 0.14, scaleW * 0.14);
          }
        }
      }
    });
  }

  function drawRoad() {
    var steps = 40;
    for (var i = steps; i >= 1; i--) {
      var z0 = (i / steps) * SPAWN_AHEAD * 0.9, z1 = ((i - 1) / steps) * SPAWN_AHEAD * 0.9;
      var p0 = perspX(0, z0), p1 = perspX(0, z1);
      var y0 = groundY(p0.scale), y1 = groundY(p1.scale);
      var k = W * PERSP_K;
      var sw0 = (ROAD_HALF + SIDEWALK_W) * p0.scale * k, sw1 = (ROAD_HALF + SIDEWALK_W) * p1.scale * k;
      var hw0 = ROAD_HALF * p0.scale * k, hw1 = ROAD_HALF * p1.scale * k;

      ctx.fillStyle = "#8a8d95";
      ctx.beginPath();
      ctx.moveTo(p0.x - sw0, y0); ctx.lineTo(p0.x + sw0, y0);
      ctx.lineTo(p1.x + sw1, y1); ctx.lineTo(p1.x - sw1, y1);
      ctx.closePath(); ctx.fill();

      var bandOffset = Math.floor((playerZ + z0) / 4) % 2;
      ctx.fillStyle = bandOffset === 0 ? "#2d2f38" : "#363843";
      ctx.beginPath();
      ctx.moveTo(p0.x - hw0, y0); ctx.lineTo(p0.x + hw0, y0);
      ctx.lineTo(p1.x + hw1, y1); ctx.lineTo(p1.x - hw1, y1);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawSpeedLines(speedRatio) {
    if (speedRatio < 0.3) return;
    var n = Math.floor(8 + speedRatio * 16);
    var cx = W / 2, cy = H * 0.42;
    ctx.save();
    ctx.lineWidth = 1.5;
    for (var i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2;
      var flicker = 0.5 + 0.5 * Math.sin(playerZ * 2.3 + i * 2.1);
      var len = (0.18 + 0.5 * speedRatio * flicker) * Math.max(W, H);
      var x1 = cx + Math.cos(ang) * (W * 0.18), y1 = cy + Math.sin(ang) * (H * 0.18);
      var x2 = cx + Math.cos(ang) * len, y2 = cy + Math.sin(ang) * len;
      ctx.strokeStyle = "rgba(255,255,255," + (0.05 + 0.18 * speedRatio * flicker) + ")";
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  }

  // キャラは奥（画面の先）へ向かって走る＝プレイヤーからは「後ろ姿」が見える構図
  function drawBike(screenX, groundY, scale, pedal, idle, flash, leanRatio) {
    var s = scale * (W * 0.1);
    if (flash && Math.floor(invTimer * 10) % 2 === 0) ctx.globalAlpha = 0.35;

    var compress = 1 - (idle ? 0 : leanRatio) * 0.18; // 速いほど前傾姿勢で少し縮む
    var hipY = groundY - s * 0.95 * compress;
    var shoulderY = groundY - s * 1.85 * compress;
    var headY = groundY - s * 2.3 * compress;
    var hipL = screenX - s * 0.2, hipR = screenX + s * 0.2;
    var shL = screenX - s * 0.42, shR = screenX + s * 0.42;

    // 後輪のヒント（脚の下にのぞく影）
    ctx.fillStyle = "#15161c";
    ctx.beginPath(); ctx.ellipse(screenX, groundY, s * 0.5, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();

    // 脚（ペダリング：左右交互に上下する）
    var phaseL = idle ? Math.PI * 0.5 : pedal;
    var phaseR = idle ? Math.PI * 1.5 : pedal + Math.PI;
    ctx.strokeStyle = "#2c3550"; ctx.lineWidth = Math.max(2, s * 0.16); ctx.lineCap = "round";
    [[hipL, phaseL], [hipR, phaseR]].forEach(function (leg) {
      var hipX = leg[0], ph = leg[1];
      var footY = groundY - s * 0.1 + Math.sin(ph) * s * 0.3;
      var footX = hipX + Math.cos(ph) * s * 0.18;
      var kneeX = hipX + (footX - hipX) * 0.5 + Math.sin(ph) * s * 0.1;
      var kneeY = (hipY + footY) / 2;
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
    });

    // 腰〜肩（後ろ姿の胴体、肩幅が腰幅より広い台形）
    ctx.fillStyle = "#ff6b4a";
    ctx.beginPath();
    ctx.moveTo(shL, shoulderY); ctx.lineTo(shR, shoulderY);
    ctx.lineTo(hipR, hipY); ctx.lineTo(hipL, hipY);
    ctx.closePath(); ctx.fill();

    // 腕とハンドルを握る手
    ctx.strokeStyle = "#2c3550"; ctx.lineWidth = Math.max(2, s * 0.14);
    var barY = groundY - s * 1.25 * compress;
    ctx.beginPath(); ctx.moveTo(shL, shoulderY + s * 0.1); ctx.lineTo(screenX - s * 0.95, barY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(shR, shoulderY + s * 0.1); ctx.lineTo(screenX + s * 0.95, barY); ctx.stroke();
    ctx.fillStyle = "#2c3550";
    ctx.beginPath(); ctx.arc(screenX - s * 0.95, barY, s * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(screenX + s * 0.95, barY, s * 0.13, 0, Math.PI * 2); ctx.fill();

    // 頭（ヘルメット）
    ctx.fillStyle = "#223a66";
    ctx.beginPath(); ctx.arc(screenX, headY, s * 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd36b";
    ctx.beginPath(); ctx.arc(screenX, headY + s * 0.05, s * 0.2, 0, Math.PI * 2); ctx.fill();

    ctx.globalAlpha = 1;
  }

  function drawObstacle(o) {
    var rel = o.z - playerZ;
    if (rel < -2 || rel > SPAWN_AHEAD + 30) return;
    var p = perspX(o.lane, Math.max(rel, 0.01));
    var y = groundY(p.scale);
    var s = p.scale * (W * 0.06);
    if (s < 1) return;
    ctx.fillStyle = "#ff6b4a";
    ctx.beginPath();
    ctx.moveTo(p.x, y - s * 1.6);
    ctx.lineTo(p.x - s, y);
    ctx.lineTo(p.x + s, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff8e8";
    ctx.fillRect(p.x - s * 0.5, y - s * 0.7, s, s * 0.22);
  }

  function render() {
    drawSky();
    drawBuildings();
    drawRoad();
    var sorted = obstacles.slice().sort(function (a, b) { return b.z - a.z; });
    sorted.forEach(drawObstacle);

    var speedRatio = clamp((speed - SPEED_START) / (SPEED_MAX - SPEED_START), 0, 1);
    drawSpeedLines(speedRatio);

    var ground = groundY(1);
    var flash = invTimer > 0;
    drawBike(W / 2 + playerX * (W * PERSP_K), ground, 1, pedalPhase, state === "ready", flash, speedRatio);
  }

  /* ---------- 入力 ---------- */
  function screenToWorldX(sx) {
    return (sx - W / 2) / (W * PERSP_K);
  }
  canvas.addEventListener("pointerdown", function (e) {
    if (state === "ready") { resetGame(); }
    if (state !== "playing") return;
    dragging = true;
    targetX = clamp(screenToWorldX(e.clientX), -(ROAD_HALF - 0.6), ROAD_HALF - 0.6);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragging || state !== "playing") return;
    targetX = clamp(screenToWorldX(e.clientX), -(ROAD_HALF - 0.6), ROAD_HALF - 0.6);
  });
  window.addEventListener("pointerup", function () { dragging = false; });
  window.addEventListener("pointercancel", function () { dragging = false; });
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  document.getElementById("start-btn").addEventListener("click", resetGame);
  document.getElementById("retry-btn").addEventListener("click", resetGame);
  document.getElementById("best-ready").textContent = best;

  /* ---------- ループ ---------- */
  var last = null;
  function loop(ts) {
    if (last == null) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
  resize();
  requestAnimationFrame(loop);
  document.getElementById("dist").textContent = "0 m";
  (function tickHud() {
    document.getElementById("dist").textContent = Math.floor(playerZ) + " m";
    requestAnimationFrame(tickHud);
  })();

  if (window.TTAnnounce) window.TTAnnounce.checkAndShow();

  window.__bike = {
    get state() { return state; }, get playerZ() { return playerZ; }, get lives() { return lives; },
    get playerX() { return playerX; }, get speed() { return speed; }, get obstacles() { return obstacles.length; }
  };
})();
