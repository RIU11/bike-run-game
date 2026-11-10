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
  var FOCAL = 60;            // 小さいほど遠近感が強い
  var ROAD_HALF = 3;         // 道の半幅（ワールド単位）
  var LANES = [-1.8, 0, 1.8];
  var SPAWN_AHEAD = 140;     // 新しい障害物を置く、プレイヤーから見た先の距離
  var BASE_INTERVAL = 46, MIN_INTERVAL = 22, INTERVAL_K = 0.9;
  var SPEED_START = 8, SPEED_MAX = 30, ACCEL = 0.14;
  var LIVES_START = 3;
  var HIT_WINDOW = 1.1;      // この距離差の間だけ当たり判定を見る
  var INVINCIBLE_SEC = 1.2;
  var PLAYER_RADIUS = 0.55, OBSTACLE_RADIUS = 0.6;

  function perspX(worldX, aheadZ) {
    var scale = FOCAL / (aheadZ + FOCAL);
    return { x: W / 2 + worldX * scale * (W * 0.46), scale: scale };
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
  var best = store.get("best", 0);

  function resetGame() {
    state = "playing";
    playerZ = 0; speed = SPEED_START; playTime = 0;
    playerX = 0; targetX = 0;
    lives = LIVES_START; invTimer = 0;
    obstacles = []; nextSpawnZ = SPAWN_AHEAD;
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

  function update(dt) {
    if (state !== "playing") return;
    playTime += dt;
    speed = Math.min(SPEED_MAX, SPEED_START + ACCEL * playTime);
    playerZ += speed * dt;
    pedalPhase += speed * dt * 2.2;
    playerX = targetX;
    if (invTimer > 0) invTimer -= dt;

    spawnIfNeeded();
    obstacles = obstacles.filter(function (o) { return o.z > playerZ - 6; });

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
  function drawRoad() {
    ctx.fillStyle = "#13203a";
    ctx.fillRect(0, 0, W, H * 0.4);
    var grad = ctx.createLinearGradient(0, 0, 0, H * 0.4);
    grad.addColorStop(0, "#0e1830"); grad.addColorStop(1, "#2c4873");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H * 0.4);

    ctx.fillStyle = "#1f2a1c";
    ctx.fillRect(0, H * 0.38, W, H * 0.62);

    var steps = 40;
    for (var i = steps; i >= 1; i--) {
      var z0 = (i / steps) * SPAWN_AHEAD * 0.9, z1 = ((i - 1) / steps) * SPAWN_AHEAD * 0.9;
      var p0 = perspX(0, z0), p1 = perspX(0, z1);
      var y0 = groundY(p0.scale), y1 = groundY(p1.scale);
      var hw0 = ROAD_HALF * p0.scale * (W * 0.46), hw1 = ROAD_HALF * p1.scale * (W * 0.46);
      var bandOffset = Math.floor((playerZ + z0) / 6) % 2;
      ctx.fillStyle = bandOffset === 0 ? "#30323a" : "#3a3c46";
      ctx.beginPath();
      ctx.moveTo(p0.x - hw0, y0); ctx.lineTo(p0.x + hw0, y0);
      ctx.lineTo(p1.x + hw1, y1); ctx.lineTo(p1.x - hw1, y1);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawBike(screenX, screenY, scale, pedal, idle, flash) {
    var s = scale * (W * 0.075);
    if (flash && Math.floor(invTimer * 10) % 2 === 0) ctx.globalAlpha = 0.35;

    ctx.strokeStyle = "#e9ecf5"; ctx.fillStyle = "#e9ecf5";
    ctx.lineWidth = Math.max(2, s * 0.09);

    var wheelR = s * 0.55;
    var backX = screenX - s * 0.75, frontX = screenX + s * 0.75, wheelY = screenY;
    ctx.beginPath(); ctx.arc(backX, wheelY, wheelR, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(frontX, wheelY, wheelR, 0, Math.PI * 2); ctx.stroke();

    var seatX = screenX - s * 0.25, seatY = screenY - s * 1.1;
    var barX = screenX + s * 0.55, barY = screenY - s * 1.0;
    var crankX = screenX, crankY = screenY - s * 0.08;
    ctx.beginPath();
    ctx.moveTo(backX, wheelY); ctx.lineTo(seatX, seatY);
    ctx.lineTo(barX, barY); ctx.lineTo(frontX, wheelY);
    ctx.moveTo(seatX, seatY); ctx.lineTo(crankX, crankY);
    ctx.stroke();

    // 体
    var headY = seatY - s * 0.95;
    ctx.beginPath(); ctx.arc(seatX + s * 0.05, headY, s * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(seatX + s * 0.05, headY + s * 0.26); ctx.lineTo(barX - s * 0.1, seatY + s * 0.05); ctx.stroke();

    // 脚（ペダリング）
    var a = idle ? 0.7 : pedal;
    var legR = s * 0.42;
    var footBX = crankX + Math.cos(a) * legR, footBY = crankY + Math.sin(a) * legR * 0.5 + s * 0.15;
    var footFX = crankX + Math.cos(a + Math.PI) * legR, footFY = crankY + Math.sin(a + Math.PI) * legR * 0.5 + s * 0.15;
    ctx.beginPath(); ctx.moveTo(seatX + s * 0.05, headY + s * 0.26); ctx.lineTo(footBX, footBY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(seatX + s * 0.05, headY + s * 0.26); ctx.lineTo(footFX, footFY); ctx.stroke();

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
    drawRoad();
    var sorted = obstacles.slice().sort(function (a, b) { return b.z - a.z; });
    sorted.forEach(drawObstacle);

    var ground = groundY(1);
    var flash = invTimer > 0;
    drawBike(W / 2 + playerX * (W * 0.46) * 1, ground, 1, pedalPhase, state === "ready", flash);
  }

  /* ---------- 入力 ---------- */
  function screenToWorldX(sx) {
    return (sx - W / 2) / (W * 0.46);
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
