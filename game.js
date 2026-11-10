// 自転車ラン（3D版）。町の道路を奥へ向かって走り、向かってくる車・自転車をよける。
import * as THREE from "./vendor/three.module.min.js";

const store = {
  get(k, d) { try { const v = localStorage.getItem("bikerun:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("bikerun:" + k, JSON.stringify(v)); } catch (e) { /* 保存できない環境では無視 */ } }
};

/* ---------- 定数 ---------- */
const LANES = [-3, 0, 3];
const ROAD_HALF = 4.6;
const SIDEWALK_W = 3.2;
const CURB_H = 0.18;
const PLAYER_LIMIT = ROAD_HALF - 0.55;
const SPEED_START = 18, SPEED_MAX = 60, ACCEL_K = 0.016; // 指数的に最高速へ近づく＝後半ほど速くなる
const ONCOMING = 8;            // 向かってくる車・自転車そのものの速さ
const SPAWN_Z = -180, BEHIND_Z = 16;
const LIVES_START = 3, INVINCIBLE_SEC = 1.3;
const FOLLOW_W = 7.5;          // 指へ引っ張られる強さ（小さいほど重く、動き出しが遅れる）
const PLAYER_HALF_W = 0.38, PLAYER_HALF_L = 0.9;
const ROAD_TILE = 30;          // 道路の模様1枚ぶんの長さ

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ---------- レンダラー ---------- */
const canvas = document.getElementById("game");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch (e) {
  window.__bikeErr = String(e);
  document.querySelector("#ready .card p").textContent = "この端末・ブラウザでは3D表示ができないため、遊べません。";
  document.getElementById("start-btn").hidden = true;
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const SKY = 0x9ad7ff;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 75, 185);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
let baseFov = 70;

scene.add(new THREE.HemisphereLight(0xeaf6ff, 0xa08f78, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(-8, 16, 10);
scene.add(sun);

/* ---------- 共通の部品 ---------- */
const matCache = new Map();
function M(color, opts) {
  const key = color + (opts ? JSON.stringify(opts) : "");
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshLambertMaterial(Object.assign({ color }, opts)); matCache.set(key, m); }
  return m;
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const PLANE = new THREE.PlaneGeometry(1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
const SPHERE = new THREE.SphereGeometry(1, 14, 10);
const ICO = new THREE.IcosahedronGeometry(1, 0);
const ICO1 = new THREE.IcosahedronGeometry(1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x || 0, y || 0, z || 0);
  return m;
}
function limb(r, mat) { const m = new THREE.Mesh(UNIT_CYL, mat); m.scale.set(r, 1, r); return m; }
const _v = new THREE.Vector3();
// 太さ一定の円柱を、点aから点bへ渡す
function placeLimb(m, a, b) {
  _v.subVectors(b, a);
  const len = _v.length() || 0.0001;
  m.position.copy(a).addScaledVector(_v, 0.5);
  m.quaternion.setFromUnitVectors(UP, _v.multiplyScalar(1 / len));
  m.scale.y = len;
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ---------- テクスチャ ---------- */
const roadTex = canvasTex(512, 1024, (g, w, h) => {
  g.fillStyle = "#4a4d56"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.08)";
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  const u = (x) => (x + ROAD_HALF) / (ROAD_HALF * 2) * w;
  g.fillStyle = "#f4f1e8";
  [-1, 1].forEach((s) => g.fillRect(u(s * (ROAD_HALF - 0.32)) - 5, 0, 10, h));
  const per = h / 4; // 模様1枚（長さ30）の中に、7.5ごとの破線が4本（つなぎ目でずれない）
  [-1.5, 1.5].forEach((x) => { for (let k = 0; k < 4; k++) g.fillRect(u(x) - 5, k * per, 10, per * 0.46); });
});

const walkTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = "#d9d0c1"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#c2b8a8"; g.fillRect(0, 0, w, 4); g.fillRect(0, 0, 4, h);
}, true);

const FACADES = ["#f2a65a", "#f6d06f", "#7cc6b6", "#f08a7e", "#b9a3e3", "#8fb8de", "#ecdcb9", "#d9785b", "#9fd19a"];
const facadeTex = FACADES.map((col) => canvasTex(128, 154, (g, w, h) => {
  g.fillStyle = col; g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(0,0,0,.08)"; g.fillRect(0, h - 8, w, 8);
  g.fillStyle = "#f7f2e8"; g.fillRect(26, 26, 76, 92);
  const gr = g.createLinearGradient(0, 32, 0, 112);
  gr.addColorStop(0, "#d4f0ff"); gr.addColorStop(1, "#86bfe3");
  g.fillStyle = gr; g.fillRect(32, 32, 64, 80);
  g.fillStyle = "rgba(255,255,255,.45)";
  g.beginPath(); g.moveTo(40, 104); g.lineTo(60, 40); g.lineTo(72, 40); g.lineTo(52, 104); g.fill();
  g.fillStyle = "#f7f2e8"; g.fillRect(62, 32, 4, 80);
  g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(22, 118, 84, 6);
}, true));

const AWNINGS = [["#e84a4a", "#fff4ec"], ["#2bb3a3", "#fff4ec"], ["#ffcc3d", "#fff4ec"], ["#7b6cf0", "#fff4ec"]];
const awningTex = AWNINGS.map(([a, b]) => canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = b; g.fillRect(0, 0, w, h);
  g.fillStyle = a; g.fillRect(0, 0, w, h / 2);
}, true));

const blobTex = canvasTex(64, 64, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
  r.addColorStop(0, "rgba(0,0,0,.55)"); r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
function blob(w, l) {
  const m = new THREE.Mesh(PLANE, blobMat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, l, 1);
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}

/* ---------- 地面・道路 ---------- */
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 700), M(0xd6cbb4));
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.03, -200);
scene.add(ground);

// 道路・歩道は動かない1枚の長い面にして、模様（テクスチャ）だけを手前へ流す（描画を軽くするため）
const ROAD_FAR = -215, ROAD_LEN = BEHIND_Z - ROAD_FAR;
function flatStrip(w, mat, x, y) {
  const m = new THREE.Mesh(PLANE, mat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, ROAD_LEN, 1);
  m.position.set(x, y, (BEHIND_Z + ROAD_FAR) / 2);
  scene.add(m);
  return m;
}
roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
roadTex.repeat.set(1, ROAD_LEN / ROAD_TILE);
flatStrip(ROAD_HALF * 2, new THREE.MeshLambertMaterial({ map: roadTex }), 0, 0);
walkTex.repeat.set(SIDEWALK_W / 1.5, ROAD_LEN / 1.5);
const walkMat = new THREE.MeshLambertMaterial({ map: walkTex });
const curbMat = M(0xa8a196);
[-1, 1].forEach((s) => {
  flatStrip(SIDEWALK_W, walkMat, s * (ROAD_HALF + SIDEWALK_W / 2), CURB_H);
  scene.add(box(0.24, CURB_H + 0.04, ROAD_LEN, curbMat, s * (ROAD_HALF + 0.12), (CURB_H + 0.04) / 2, (BEHIND_Z + ROAD_FAR) / 2));
});

/* ---------- 町並み（建物） ---------- */
const roofMats = [M(0xc4553b), M(0x5b6478), M(0x3f8f86), M(0xa0522d)];
const ledgeMat = M(0x8c8579);
const SIGN_COLS = [0xe84a4a, 0xffcc3d, 0x2bb3a3, 0xff7ab8, 0x4a7cf0];

const facadeMats = facadeTex.map((t) => new THREE.MeshLambertMaterial({ map: t }));
// 窓がちょうど何個か並ぶように、面ごとにUVを引き伸ばした箱（1つの描画で済む）
function facadeGeo(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const cu = (len) => Math.max(1, Math.round(len / 2.5)), cv = Math.max(2, Math.round(h / 3));
  const spans = [[cu(d), cv], [cu(d), cv], null, null, [cu(w), cv], [cu(w), cv]]; // 面の順：+x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      if (spans[f]) uv.setXY(k, uv.getX(k) * spans[f][0], uv.getY(k) * spans[f][1]);
      else uv.setXY(k, 0.08, 0.95); // 屋上と底は、窓の無い壁の色だけ
    }
  }
  geo.translate(0, h / 2, 0);
  return geo;
}

function makeBuilding(side) {
  const w = rnd(6, 9), h = rnd(6, 20), d = rnd(7, 13);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(facadeGeo(w, h, d), pick(facadeMats)));

  const faceX = -side * w / 2; // 道路側の壁（建物の中心から見た位置）
  if (Math.random() < 0.45) {
    // 道路側に三角の妻が見える切妻屋根
    const rh = rnd(1.6, 3);
    const shape = new THREE.Shape();
    shape.moveTo(-(d + 0.3) / 2, 0); shape.lineTo((d + 0.3) / 2, 0); shape.lineTo(0, rh); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w + 0.3, bevelEnabled: false });
    geo.translate(0, 0, -(w + 0.3) / 2);
    const roof = new THREE.Mesh(geo, pick(roofMats));
    roof.rotation.y = Math.PI / 2;
    roof.position.y = h;
    g.add(roof);
  } else {
    g.add(box(w + 0.3, 0.35, d + 0.3, ledgeMat, 0, h + 0.17, 0));
  }
  if (Math.random() < 0.55) {
    // 1階の日よけ
    const len = d * rnd(0.55, 0.85);
    const tex = pick(awningTex).clone();
    tex.repeat.set(1, Math.max(2, Math.round(len / 0.9)));
    const aw = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ map: tex }));
    aw.scale.set(1.6, 0.08, len);
    aw.position.set(faceX - side * 0.75, 3.1, 0);
    aw.rotation.z = side * 0.38;
    g.add(aw);
  }
  if (Math.random() < 0.35) {
    // 壁から突き出た縦長の看板
    g.add(box(0.16, 2.4, 1.0, M(pick(SIGN_COLS)), faceX - side * 0.6, rnd(5, Math.max(5.5, h - 2)), rnd(-d * 0.3, d * 0.3)));
  }
  return { group: g, w, d };
}

const buildings = { "-1": [], "1": [] };
const buildingFar = { "-1": 0, "1": 0 };
[-1, 1].forEach((side) => {
  let edge = BEHIND_Z;
  while (edge > ROAD_FAR) {
    const b = makeBuilding(side);
    b.group.position.set(side * (ROAD_HALF + SIDEWALK_W + b.w / 2), 0, edge - b.d / 2);
    edge -= b.d + rnd(0.4, 2.2);
    scene.add(b.group);
    buildings[side].push(b);
  }
  buildingFar[side] = edge;
});

/* ---------- 歩道の木と街灯 ---------- */
const trunkMat = M(0x8b5a3c);
const leafMats = [M(0x5cbf5a, { flatShading: true }), M(0x48a84f, { flatShading: true })];
const poleMat = M(0x3c5a4f);
const lampMat = new THREE.MeshLambertMaterial({ color: 0xfff1b8, emissive: 0xffe08a, emissiveIntensity: 0.6 });

// 同じ形のものは「まとめて描く」（InstancedMesh）ことで、何十本あっても描画1回で済ませる
const PROP_GAP = 24; // 同じ種類どうしの間隔（木と街灯はその半分ずらして交互に並ぶ）
const propSlots = [];
[-1, 1].forEach((side) => {
  ["tree", "lamp"].forEach((type, ti) => {
    const series = [];
    for (let z = BEHIND_Z - ti * PROP_GAP / 2 - (side > 0 ? 3 : 9); z > ROAD_FAR; z -= PROP_GAP) {
      series.push({ side, type, z, x: side * (ROAD_HALF + 0.8), tilt: rnd(-0.4, 0.4) });
    }
    series.forEach((p) => { p.wrap = series.length * PROP_GAP; propSlots.push(p); }); // 後ろへ抜けたら列の一番奥へ回す
  });
});
const trees = propSlots.filter((p) => p.type === "tree"), lamps = propSlots.filter((p) => p.type === "lamp");
function instanced(geo, mat, n) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.frustumCulled = false; // 中身が毎フレーム動くので、まとめての視界外判定はしない
  scene.add(m);
  return m;
}
const trunkI = instanced(UNIT_CYL, trunkMat, trees.length);
const leafAI = instanced(ICO, leafMats[0], trees.length);
const leafBI = instanced(ICO, leafMats[1], trees.length);
const poleI = instanced(UNIT_CYL, poleMat, lamps.length);
const armI = instanced(BOX, poleMat, lamps.length);
const headI = instanced(BOX, lampMat, lamps.length);
const dummy = new THREE.Object3D();
function setInst(mesh, i, x, y, z, sx, sy, sz, ry) {
  dummy.position.set(x, y, z);
  dummy.scale.set(sx, sy, sz);
  dummy.rotation.set(0, ry || 0, 0);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}
function placeProps() {
  trees.forEach((p, i) => {
    setInst(trunkI, i, p.x, CURB_H + 0.95, p.z, 0.16, 1.9, 0.16);
    setInst(leafAI, i, p.x, CURB_H + 2.5, p.z, 1.15, 1.15, 1.15, p.tilt);
    setInst(leafBI, i, p.x + 0.3, CURB_H + 3.2, p.z - 0.2, 0.8, 0.8, 0.8, -p.tilt);
  });
  lamps.forEach((p, i) => {
    setInst(poleI, i, p.x, CURB_H + 2.2, p.z, 0.08, 4.4, 0.08);
    setInst(armI, i, p.x - p.side * 0.55, CURB_H + 4.4, p.z, 1.1, 0.08, 0.08);
    setInst(headI, i, p.x - p.side * 1.2, CURB_H + 4.35, p.z, 0.55, 0.18, 0.32);
  });
  [trunkI, leafAI, leafBI, poleI, armI, headI].forEach((m) => { m.instanceMatrix.needsUpdate = true; });
}
placeProps();

/* ---------- 空の雲 ---------- */
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35, flatShading: true, fog: false });
const clouds = [];
for (let i = 0; i < 5; i++) {
  const g = new THREE.Group();
  const n = 3;
  for (let j = 0; j < n; j++) {
    const m = new THREE.Mesh(ICO1, cloudMat);
    m.scale.set(rnd(1, 1.6), rnd(0.7, 1), rnd(0.8, 1.2));
    m.position.set(j * 1.3 - n * 0.6, rnd(-0.2, 0.3), rnd(-0.3, 0.3));
    g.add(m);
  }
  g.scale.setScalar(rnd(5, 9));
  g.position.set(rnd(-90, 90), rnd(34, 58), rnd(-320, -160));
  scene.add(g);
  clouds.push(g);
}

/* ---------- スピードの筋（速いときだけ見える） ---------- */
const streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
const streaks = [];
function resetStreak(s, z) {
  s.x = (Math.random() < 0.5 ? -1 : 1) * rnd(2.5, 7);
  s.y = rnd(0.6, 6.5);
  s.z = z;
}
for (let i = 0; i < 22; i++) {
  const s = {};
  resetStreak(s, rnd(-70, 5));
  streaks.push(s);
}
const streakI = instanced(BOX, streakMat, streaks.length);
function placeStreaks() {
  streaks.forEach((s, i) => setInst(streakI, i, s.x, s.y, s.z, 0.04, 0.04, 4.5));
  streakI.instanceMatrix.needsUpdate = true;
}
placeStreaks();

/* ---------- 自転車に乗った人（自分・向かってくる自転車） ---------- */
const WHEEL_R = 0.42;
const TORUS = new THREE.TorusGeometry(WHEEL_R, 0.06, 8, 22).rotateY(Math.PI / 2);
const CRANK_C = V(0, 0.45, 0.08), HIP = V(0, 1.12, 0.26);
const THIGH = 0.5, SHIN = 0.5, CRANK_R = 0.17;

// 前は-Z方向。カメラから見ると後ろ姿になる
function buildCyclist(c) {
  const g = new THREE.Group();
  const frame = M(c.frame), tire = M(0x1c1e24), metal = M(0xaab2bb);
  const wheels = [V(0, WHEEL_R, 0.64), V(0, WHEEL_R, -0.64)].map((p) => {
    const w = new THREE.Mesh(TORUS, tire);
    w.position.copy(p);
    g.add(w);
    return w;
  });
  const seat = V(0, 1.02, 0.3), head = V(0, 1.0, -0.46), stem = V(0, 1.14, -0.52);
  [[CRANK_C, seat], [CRANK_C, head], [seat, head], [CRANK_C, wheels[0].position],
    [head, wheels[1].position], [head, stem]].forEach(([a, b]) => {
    const t = limb(0.045, frame); placeLimb(t, a, b); g.add(t);
  });
  const bar = limb(0.035, metal); placeLimb(bar, V(-0.32, 1.14, -0.54), V(0.32, 1.14, -0.54)); g.add(bar);
  g.add(box(0.2, 0.07, 0.34, M(0x2a2a30), 0, 1.06, 0.3)); // サドル
  const crank = new THREE.Group();
  crank.position.copy(CRANK_C);
  crank.add(box(0.05, CRANK_R * 2, 0.05, metal));
  g.add(crank);

  const top = M(c.top), pants = M(c.pants), skin = M(0xf2c9a0);
  const torso = new THREE.Group();
  torso.position.copy(HIP);
  torso.rotation.x = -0.72; // 前かがみ
  g.add(torso);
  torso.add(box(0.46, 0.62, 0.3, top, 0, 0.31, 0));
  torso.add(box(0.36, 0.4, 0.18, M(c.bag), 0, 0.34, 0.22)); // 背中のリュック
  const headM = new THREE.Mesh(SPHERE, skin); headM.scale.setScalar(0.17); headM.position.set(0, 0.78, -0.08); torso.add(headM);
  const hel = new THREE.Mesh(SPHERE, M(c.helmet)); hel.scale.set(0.2, 0.16, 0.22); hel.position.set(0, 0.84, -0.06); torso.add(hel);
  torso.updateMatrix();
  [-1, 1].forEach((s) => {
    const sh = V(s * 0.22, 0.56, -0.02).applyMatrix4(torso.matrix);
    const hand = V(s * 0.3, 1.15, -0.54);
    const elbow = sh.clone().lerp(hand, 0.5); elbow.y -= 0.05; elbow.x += s * 0.06;
    const up = limb(0.065, top); placeLimb(up, sh, elbow); g.add(up);
    const lo = limb(0.05, skin); placeLimb(lo, elbow, hand); g.add(lo);
  });
  const legs = [-1, 1].map((s, i) => {
    const thigh = limb(0.085, pants), shin = limb(0.07, pants);
    const foot = box(0.12, 0.09, 0.24, M(0xf7f7f7));
    g.add(thigh, shin, foot);
    return { x: s * 0.14, off: i * Math.PI, thigh, shin, foot };
  });
  g.add(blob(1.1, 2.1));
  return { group: g, crank, wheels, legs };
}

const _H = V(0, 0, 0), _K = V(0, 0, 0), _P = V(0, 0, 0);
// ペダルの角度から、脚（もも・すね）の形を計算して置く
function poseCyclist(r, ang, spin) {
  r.crank.rotation.x = Math.PI / 2 - ang;
  if (spin) r.wheels.forEach((w) => { w.rotation.x -= spin; });
  for (const L of r.legs) {
    const a = ang + L.off;
    const pz = CRANK_C.z + CRANK_R * Math.cos(a), py = CRANK_C.y + CRANK_R * Math.sin(a);
    _H.set(L.x, HIP.y, HIP.z);
    _P.set(L.x * 1.15, py, pz);
    const dz = pz - HIP.z, dy = py - HIP.y;
    const d = Math.min(Math.hypot(dz, dy), THIGH + SHIN - 0.002);
    const base = Math.atan2(dy, dz);
    const al = Math.acos(clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
    const k1 = base + al, k2 = base - al;
    const k = Math.cos(k1) < Math.cos(k2) ? k1 : k2; // ひざは前（-Z）に出る方
    _K.set(L.x * 1.08, HIP.y + THIGH * Math.sin(k), HIP.z + THIGH * Math.cos(k));
    placeLimb(L.thigh, _H, _K);
    placeLimb(L.shin, _K, _P);
    L.foot.position.set(_P.x, _P.y - 0.04, _P.z - 0.03);
  }
}

const player = buildCyclist({ frame: 0x2e86ff, top: 0xff6b35, pants: 0x2d3a64, helmet: 0xffd23f, bag: 0x26b5a5 });
scene.add(player.group);

/* ---------- 向かってくる車・自転車 ---------- */
const CAR_COLS = [0xe8453c, 0xffc93c, 0x3a86ff, 0xf5f5f5, 0x2ec4b6, 0xff8c42, 0x8e7dff, 0x5c6b73];
const WHEEL = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 12).rotateZ(Math.PI / 2);
const glassMat = M(0x30435f), tireMat = M(0x22252b), bumperMat = M(0x9aa1ab);
const headLightMat = new THREE.MeshLambertMaterial({ color: 0xfffbe0, emissive: 0xfff3b0, emissiveIntensity: 0.9 });

// 前（ライト側）は+Z＝プレイヤーの方を向く
function buildVehicle(kind) {
  const g = new THREE.Group();
  const body = M(pick(CAR_COLS));
  let halfW, halfL, wheelZ;
  if (kind === "car") {
    g.add(box(1.9, 0.72, 4.0, body, 0, 0.66, 0));
    g.add(box(1.62, 0.62, 2.1, glassMat, 0, 1.31, -0.25));
    g.add(box(1.66, 0.1, 1.9, body, 0, 1.66, -0.3));
    g.add(box(1.96, 0.2, 0.2, bumperMat, 0, 0.4, 2.0));
    [-0.62, 0.62].forEach((x) => g.add(box(0.38, 0.18, 0.06, headLightMat, x, 0.78, 2.01)));
    halfW = 0.97; halfL = 2.05; wheelZ = [-1.3, 1.3];
  } else if (kind === "van") {
    g.add(box(2.0, 1.75, 4.6, body, 0, 1.2, 0));
    g.add(box(2.02, 0.55, 2.8, glassMat, 0, 1.6, -0.4));
    g.add(box(1.9, 0.7, 0.06, glassMat, 0, 1.55, 2.31));
    g.add(box(2.04, 0.22, 0.2, bumperMat, 0, 0.42, 2.3));
    [-0.66, 0.66].forEach((x) => g.add(box(0.36, 0.2, 0.06, headLightMat, x, 0.86, 2.31)));
    halfW = 1.0; halfL = 2.35; wheelZ = [-1.6, 1.6];
  } else {
    g.add(box(2.35, 2.5, 9.0, body, 0, 1.65, 0));
    g.add(box(2.37, 0.85, 7.6, glassMat, 0, 2.05, -0.4));
    g.add(box(2.1, 1.1, 0.06, glassMat, 0, 2.0, 4.51));
    g.add(box(2.36, 0.25, 0.2, bumperMat, 0, 0.5, 4.5));
    [-0.8, 0.8].forEach((x) => g.add(box(0.36, 0.22, 0.06, headLightMat, x, 0.95, 4.52)));
    halfW = 1.18; halfL = 4.55; wheelZ = [-3.2, 3.2];
  }
  wheelZ.forEach((z) => [-1, 1].forEach((s) => {
    const w = new THREE.Mesh(WHEEL, tireMat);
    w.position.set(s * (halfW - 0.02), 0.36, z);
    g.add(w);
  }));
  g.add(blob(halfW * 2.4, halfL * 2.25));
  return { group: g, kind, halfW, halfL };
}
const RIDER_COLS = { frame: [0xe8453c, 0x22c55e, 0xa855f7, 0xf59e0b], top: [0x3b82f6, 0x10b981, 0xef4444, 0xf472b6, 0xfacc15], pants: [0x1f2937, 0x4b5563, 0x3f3a8a], helmet: [0xffffff, 0xff5a5a, 0x60a5fa], bag: [0xf97316, 0x334155, 0x84cc16] };
function buildOncomingBike() {
  const rig = buildCyclist({ frame: pick(RIDER_COLS.frame), top: pick(RIDER_COLS.top), pants: pick(RIDER_COLS.pants), helmet: pick(RIDER_COLS.helmet), bag: pick(RIDER_COLS.bag) });
  return { group: rig.group, kind: "bike", halfW: 0.42, halfL: 0.95, rig, crankAng: Math.random() * 6 };
}

const pool = { car: [], van: [], bus: [], bike: [] };
const allObs = [];
[["car", 16], ["van", 6], ["bus", 3], ["bike", 9]].forEach(([kind, n]) => {
  for (let i = 0; i < n; i++) {
    const o = kind === "bike" ? buildOncomingBike() : buildVehicle(kind);
    o.active = false;
    o.group.visible = false;
    scene.add(o.group);
    pool[kind].push(o);
    allObs.push(o);
  }
});

let lastFree = [0, 1, 2]; // 直前の列で空いていた車線（番号）
function spawnRow(z) {
  const ratio = clamp((speed - SPEED_START) / (SPEED_MAX - SPEED_START), 0, 1);
  const n = Math.random() < 0.4 + 0.25 * ratio ? 2 : 1; // 速くなるほど2車線ふさぎが増える（3車線すべてはふさがない）
  let blocked, free;
  // 前の列で空いていた車線のとなりまでには、必ず空きを作る（端から端への大移動を強いない）
  for (let tries = 0; tries < 8; tries++) {
    blocked = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, n);
    free = [0, 1, 2].filter((i) => !blocked.includes(i));
    if (free.some((f) => lastFree.some((p) => Math.abs(f - p) <= 1))) break;
  }
  lastFree = free;
  blocked.forEach((li) => {
    const x = LANES[li];
    const r = Math.random();
    const kind = r < 0.5 ? "car" : r < 0.75 ? "bike" : r < 0.92 ? "van" : "bus";
    const o = pool[kind].find((p) => !p.active);
    if (!o) return;
    o.active = true; o.hit = false; o.hitT = 0;
    o.group.visible = true;
    o.group.position.set(x + rnd(-0.25, 0.25) * (kind === "bike" ? 2 : 1), 0, z - o.halfL - rnd(0, 6));
    o.group.rotation.set(0, kind === "bike" ? Math.PI : 0, 0);
    o.prevZ = o.group.position.z;
  });
}
function deactivate(o) { o.active = false; o.group.visible = false; }

/* ---------- 状態 ---------- */
let state = "ready"; // ready | playing | over
let speed = SPEED_START, playTime = 0, distance = 0;
let playerX = 0, playerVX = 0, targetX = 0, dragging = false, lean = 0;
let lives = LIVES_START, invT = 0, shake = 0;
let crankAng = 1.0, camX = 0, rowAcc = 0, nextGap = 40, time = 0;
let best = store.get("best", 0);

function renderLives() {
  const el = document.getElementById("lives");
  el.innerHTML = "";
  for (let i = 0; i < LIVES_START; i++) {
    const d = document.createElement("div");
    d.className = "life" + (i >= lives ? " lost" : "");
    el.appendChild(d);
  }
}

function startGame() {
  state = "playing";
  speed = SPEED_START; playTime = 0; distance = 0;
  playerX = 0; playerVX = 0; targetX = 0; lean = 0;
  lives = LIVES_START; invT = 0; shake = 0;
  rowAcc = 0; nextGap = 30; lastFree = [0, 1, 2];
  allObs.forEach(deactivate);
  for (let z = -100; z > SPAWN_Z; z -= 32) spawnRow(z); // 走り出してすぐぶつからないよう、最初の列は少し先から
  renderLives();
  document.getElementById("ready").hidden = true;
  document.getElementById("over").hidden = true;
}

function gameOver() {
  state = "over";
  dragging = false;
  const dist = Math.floor(distance);
  if (dist > best) { best = dist; store.set("best", best); }
  document.getElementById("dist-final").textContent = dist;
  document.getElementById("best-final").textContent = best;
  document.getElementById("best-ready").textContent = best;
  document.getElementById("over").hidden = false;
}

const flashEl = document.getElementById("hitflash");
function hit(o) {
  lives--;
  invT = INVINCIBLE_SEC;
  shake = 0.45;
  flashEl.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => flashEl.classList.remove("on")));
  o.hit = true; o.hitT = 0;
  o.vy = 7;
  o.vx = (o.group.position.x - playerX >= 0 ? 1 : -1) * 6;
  o.spin = (Math.random() < 0.5 ? -1 : 1) * 5;
  renderLives();
  if (lives <= 0) gameOver();
}

/* ---------- 毎フレームの更新 ---------- */
function scrollWorld(dz) {
  roadTex.offset.y = (roadTex.offset.y + dz / ROAD_TILE) % 1;
  walkTex.offset.y = (walkTex.offset.y + dz / 1.5) % 1;
  propSlots.forEach((p) => {
    p.z += dz;
    if (p.z > BEHIND_Z) p.z -= p.wrap;
  });
  placeProps();
  [-1, 1].forEach((side) => {
    buildingFar[side] += dz;
    buildings[side].forEach((b) => {
      b.group.position.z += dz;
      if (b.group.position.z - b.d / 2 > BEHIND_Z) {
        b.group.position.z = buildingFar[side] - b.d / 2;
        buildingFar[side] -= b.d + rnd(0.4, 2.2);
      }
    });
  });
  clouds.forEach((c) => {
    c.position.z += dz * 0.02;
    if (c.position.z > -120) c.position.z -= 200;
  });
  streaks.forEach((s) => {
    s.z += dz * 1.7;
    if (s.z > 8) resetStreak(s, rnd(-80, -50));
  });
  placeStreaks();
}

function updateObstacles(dt) {
  const dzObs = (speed + ONCOMING) * dt;
  for (const o of allObs) {
    if (!o.active) continue;
    const p = o.group.position;
    o.prevZ = p.z;
    if (o.hit) {
      o.hitT += dt;
      p.z += speed * dt * 0.6;
      p.x += o.vx * dt;
      o.vy -= 20 * dt;
      p.y = Math.max(0, p.y + o.vy * dt);
      o.group.rotation.x += o.spin * dt;
      if (o.hitT > 1.4) { deactivate(o); continue; }
    } else {
      p.z += dzObs;
    }
    if (o.rig) { o.crankAng += dt * 9; poseCyclist(o.rig, o.crankAng, dt * 12); }
    if (p.z - o.halfL > BEHIND_Z) { deactivate(o); continue; }
    if (!o.hit && invT <= 0 && state === "playing") {
      const front = p.z + o.halfL, backPrev = o.prevZ - o.halfL;
      if (front >= -PLAYER_HALF_L && backPrev <= PLAYER_HALF_L && Math.abs(p.x - playerX) < o.halfW + PLAYER_HALF_W) hit(o);
    }
  }
}

function update(dt) {
  time += dt;
  const ratio = clamp((speed - SPEED_START) / (SPEED_MAX - SPEED_START), 0, 1);
  if (state === "playing") {
    playTime += dt;
    speed = SPEED_MAX - (SPEED_MAX - SPEED_START) * Math.exp(-ACCEL_K * playTime);
    const dz = speed * dt;
    distance += dz;
    scrollWorld(dz);
    rowAcc += (speed + ONCOMING) * dt;
    if (rowAcc >= nextGap) {
      rowAcc = 0;
      spawnRow(SPAWN_Z);
      nextGap = clamp(32 - speed * 0.25, 20, 32) + rnd(-2.5, 2.5);
    }
    updateObstacles(dt);
    if (invT > 0) invT -= dt;

    // 重さのあるばねで指の位置へ引っ張る：動き出しはゆっくり、ぬるっと加速して、行き過ぎずに止まる
    playerVX += (FOLLOW_W * FOLLOW_W * (targetX - playerX) - 2 * FOLLOW_W * playerVX) * dt;
    playerX = clamp(playerX + playerVX * dt, -PLAYER_LIMIT, PLAYER_LIMIT);
    lean += (clamp(-playerVX * 0.075, -0.55, 0.55) - lean) * (1 - Math.exp(-12 * dt));
    crankAng += speed * dt * 0.55;
    poseCyclist(player, crankAng, speed * dt / WHEEL_R);
  } else if (state === "ready") {
    poseCyclist(player, 1.0, 0);
  }
  if (state !== "playing") lean += (0 - lean) * (1 - Math.exp(-8 * dt));

  player.group.position.x = playerX;
  player.group.rotation.z = lean;
  player.group.rotation.y = lean * 0.5;
  player.group.visible = invT > 0 && state === "playing" ? Math.floor(invT * 12) % 2 === 0 : true;

  streakMat.opacity = state === "playing" ? clamp((ratio - 0.25) * 0.7, 0, 0.42) : 0;

  camX += (playerX * 0.45 - camX) * (1 - Math.exp(-5 * dt));
  shake = Math.max(0, shake - dt);
  const sh = shake * 0.35;
  const bob = state === "playing" ? Math.sin(time * 9) * 0.03 * ratio : 0;
  camera.position.set(camX + (Math.random() - 0.5) * sh, 5.2 + bob + (Math.random() - 0.5) * sh, 9.2);
  camera.lookAt(camX * 0.6, 1.0, -16);
  const fov = Math.min(88, baseFov + (state === "playing" ? ratio * 12 : 0));
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

/* ---------- 入力 ---------- */
function toTarget(clientX) {
  const f = clientX / (window.innerWidth || 1);
  targetX = clamp((f - 0.5) * 2 * PLAYER_LIMIT * 1.2, -PLAYER_LIMIT, PLAYER_LIMIT);
}
let activeId = null; // 最初に触れた指だけで操作する（2本目以降の指は無視）
window.addEventListener("pointerdown", (e) => {
  if (activeId !== null || (e.target.closest && e.target.closest("#announce, #over, #pause, button"))) return;
  if (state === "ready") startGame();
  if (state !== "playing") return;
  activeId = e.pointerId;
  dragging = true;
  toTarget(e.clientX);
});
window.addEventListener("pointermove", (e) => { if (e.pointerId === activeId && dragging && state === "playing") toTarget(e.clientX); });
window.addEventListener("pointerup", (e) => { if (e.pointerId === activeId) { activeId = null; dragging = false; } });
window.addEventListener("pointercancel", (e) => { if (e.pointerId === activeId) { activeId = null; dragging = false; } });

// ほかのアプリに切り替えたり通知を開いたりしたら、触っていた指を解除して一時停止
function pauseGame() {
  activeId = null; dragging = false;
  if (state !== "playing") return;
  state = "paused";
  document.getElementById("pause").hidden = false;
}
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });
window.addEventListener("blur", pauseGame);
window.addEventListener("pagehide", pauseGame);
document.getElementById("resume-btn").addEventListener("click", () => {
  document.getElementById("pause").hidden = true;
  state = "playing";
  clock.getDelta(); // 止まっていた時間ぶん一気に進まないように
});
document.getElementById("start-btn").addEventListener("click", startGame);
document.getElementById("retry-btn").addEventListener("click", startGame);
document.getElementById("best-ready").textContent = best;

/* ---------- 画面サイズ・ループ ---------- */
function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 縦長の画面でも、自分のまわりの道幅が見えるように視野を広げる
  baseFov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(0.34 / camera.aspect)), 58, 78);
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();
renderLives();
poseCyclist(player, 1.0, 0);

const distEl = document.getElementById("dist");
let lastShown = -1;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt);
  renderer.render(scene, camera);
  const shown = Math.floor(distance);
  if (shown !== lastShown) { distEl.textContent = shown + " m"; lastShown = shown; }
});

if (window.TTAnnounce) window.TTAnnounce.checkAndShow();

window.__bike = {
  get state() { return state; }, get playerZ() { return distance; }, get lives() { return lives; },
  get playerX() { return playerX; }, get targetX() { return targetX; }, get lean() { return lean; },
  get speed() { return speed; }, get obstacles() { return allObs.filter((o) => o.active).length; },
  get drawCalls() { return renderer.info.render.calls; }
};
