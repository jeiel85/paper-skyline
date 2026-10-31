// 3D 비행 시뮬레이션 + 점수 판정. DOM·Three.js에 의존하지 않아 Node 테스트에서 그대로 돌린다.
// 점질량 글라이더: 양력은 속도에 수직, 뱅크각만큼 기울어져 선회를 만든다.
import { START_H, CITY_END, buildingAt, buildingsNear, surfaceAt } from './world.js';

export const PHYS = {
  G: 9.8,
  KL: 0.04, // 양력 계수 스케일
  CD0: 0.045,
  KI: 0.045, // 유도 항력
  TRIM: 0.07, // 무입력 받음각
  STALL: 0.34,
  PITCH: 0.26, // 입력 1일 때 받음각 변화
  BANK: 1.05, // 최대 뱅크각(rad)
  REFV: 25,
  VMAX: 75,
  R: 0.6, // 충돌 반경
};

export const POINTS = {
  closeCall: 80,
  star: 100,
  thermal: 50,
  loop: 400,
  turn: 250,
  speed: 120,
  touchGo: 150,
  perfect: 600,
  smooth: 250,
  roofRest: 300,
};

const TAU = Math.PI * 2;
const LOOP = TAU * 0.94; // 340° 이상 돌면 한 바퀴로 인정

// ---------- 작은 벡터 유틸 ----------
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const UP = [0, 1, 0];

export function createRun(world) {
  return {
    world,
    phase: 'aim', // aim → power → fly → landed → done
    phaseT: 0,
    aim: 0.25,
    power: 0,
    p: {
      x: 0, y: START_H + PHYS.R, z: -3,
      vx: 0, vy: 0, vz: 0,
      alpha: PHYS.TRIM, bank: 0,
      f: [0, 0, 1], r: [-1, 0, 0], n: [0, 1, 0], // 진행·오른쪽·양력 방향
      spin: 0,
    },
    pitchAcc: 0,
    yawAcc: 0,
    durability: 3,
    crumpled: false,
    invuln: 0,
    touching: null, // 'roof' | 'ground' | null
    touchB: null,
    actionScore: 0,
    combo: 0,
    comboT: 0,
    skimT: 0,
    canyonT: 0,
    speedT: 0,
    stillT: 0,
    endT: 0,
    endReason: null,
    landing: null,
    taken: new Set(),
    closeCalls: new Set(),
    thermals: new Set(),
    awards: [],
    stats: { loops: 0, turns: 0, stars: 0, closeCalls: 0, skims: 0, touchGo: 0, thermals: 0, canyon: 0, speed: 0, hits: 0, maxSpeed: 0, airTime: 0 },
  };
}

export const comboMult = (combo) => Math.min(5, 1 + combo * 0.25);
export const speedOf = (p) => Math.hypot(p.vx, p.vy, p.vz);

export function distanceOf(run) {
  return Math.max(0, Math.floor(run.p.z));
}

export function totalScore(run) {
  return distanceOf(run) + run.actionScore;
}

// 렌더링용 기체 자세: 기수는 진행 방향에서 받음각만큼 양력 쪽으로 들려 있다
export function attitude(p) {
  const ca = Math.cos(p.alpha), sa = Math.sin(p.alpha);
  const nose = norm([p.f[0] * ca + p.n[0] * sa, p.f[1] * ca + p.n[1] * sa, p.f[2] * ca + p.n[2] * sa]);
  const up = norm([p.n[0] * ca - p.f[0] * sa, p.n[1] * ca - p.f[1] * sa, p.n[2] * ca - p.f[2] * sa]);
  return { nose, up };
}

function award(run, key, label, base, emit) {
  const mult = comboMult(run.combo);
  const pts = Math.round(base * mult);
  run.actionScore += pts;
  run.combo++;
  run.comboT = 4;
  run.awards.push({ key, label, pts });
  emit('award', { key, label, pts, mult, x: run.p.x, y: run.p.y, z: run.p.z });
}

function hit(run, emit, kind) {
  if (run.invuln > 0 || run.crumpled) return;
  run.durability--;
  run.stats.hits++;
  run.combo = 0;
  run.comboT = 0;
  run.invuln = 0.5;
  run.skimT = 0;
  run.canyonT = 0;
  run.pitchAcc = 0;
  run.yawAcc = 0;
  emit('hit', { kind, x: run.p.x, y: run.p.y, z: run.p.z, left: run.durability });
  if (run.durability <= 0) {
    run.crumpled = true;
    emit('wreck', { x: run.p.x, y: run.p.y, z: run.p.z });
  }
}

function liftCoef(a) {
  const s = Math.abs(a);
  if (s <= PHYS.STALL) return 5.6 * a;
  const peak = 5.6 * PHYS.STALL * Math.sign(a);
  const flat = 1.1 * Math.sin(2 * a);
  const t = Math.min(1, (s - PHYS.STALL) / 0.25);
  return peak * (1 - t) + flat * t;
}

function updraft(run, emit) {
  const { p, world } = run;
  let a = 0;
  for (let i = 0; i < world.vents.length; i++) {
    const v = world.vents[i];
    const dz = p.z - v.z;
    if (Math.abs(dz) > v.sigma * 3) continue;
    const dx = p.x - v.x;
    if (Math.abs(dx) > v.sigma * 3) continue;
    const hy = p.y - v.top;
    if (hy < 0 || hy > v.height) continue;
    const va = v.strength * Math.exp(-(dx * dx + dz * dz) / (2 * v.sigma * v.sigma)) * (1 - hy / v.height);
    if (va > 6 && !run.crumpled && !run.thermals.has(i)) {
      run.thermals.add(i);
      run.stats.thermals++;
      award(run, 'thermal', '상승기류', POINTS.thermal, emit);
    }
    a += va;
  }
  return a;
}

function flyPhysics(run, input, dt, emit) {
  const p = run.p;
  const V = [p.vx, p.vy, p.vz];
  const v = len(V);
  if (v > 0.3) p.f = norm(V);
  // 오른쪽 축: 수직 비행처럼 진행 방향이 위/아래면 이전 축을 이어 쓴다
  const rc = cross(p.f, UP);
  if (len(rc) > 0.15) p.r = norm(rc);
  else {
    const d = dot(p.r, p.f);
    p.r = norm([p.r[0] - d * p.f[0], p.r[1] - d * p.f[1], p.r[2] - d * p.f[2]]);
  }
  const n0 = cross(p.r, p.f);

  const q = Math.min(2.2, (v / PHYS.REFV) ** 2) + 0.15;
  const flying = run.phase === 'fly' && !run.crumpled;
  const pitchIn = flying ? Math.max(-1, Math.min(1, input.pitch || 0)) : 0;
  const rollIn = flying ? Math.max(-1, Math.min(1, input.roll || 0)) : 0;
  const alphaT = PHYS.TRIM + PHYS.PITCH * pitchIn;
  p.alpha += (alphaT - p.alpha) * Math.min(1, dt * 6 * q);
  p.bank += (rollIn * PHYS.BANK - p.bank) * Math.min(1, dt * 3);
  if (run.touching) p.bank *= 1 - Math.min(1, dt * 8);

  const cb = Math.cos(p.bank), sb = Math.sin(p.bank);
  p.n = [n0[0] * cb + p.r[0] * sb, n0[1] * cb + p.r[1] * sb, n0[2] * cb + p.r[2] * sb];

  let cl = 0;
  let cd = 0.6;
  if (!run.crumpled) {
    cl = liftCoef(p.alpha);
    cd = PHYS.CD0 + PHYS.KI * Math.min(cl * cl, 3) + 6 * Math.max(0, Math.abs(Math.sin(p.alpha)) - PHYS.STALL) ** 2;
    const hAbove = p.y - surfaceAt(run.world, p.x, p.z);
    if (hAbove > 0 && hAbove < 8) cl *= 1 + 0.5 * (1 - hAbove / 8); // 지면 효과
  } else {
    p.spin += dt;
  }
  const L = PHYS.KL * cl * v * v;
  const D = PHYS.KL * cd * v * v;
  const ax = p.n[0] * L - p.f[0] * D;
  let ay = p.n[1] * L - p.f[1] * D - PHYS.G;
  const az = p.n[2] * L - p.f[2] * D;
  if (run.phase === 'fly') ay += updraft(run, emit);

  const fPrev = p.f;
  const rPrev = p.r;
  p.vx += ax * dt;
  p.vy += ay * dt;
  p.vz += az * dt;
  const sp = speedOf(p);
  if (sp > PHYS.VMAX) {
    const k = PHYS.VMAX / sp;
    p.vx *= k; p.vy *= k; p.vz *= k;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;

  // 루프(피치 축 회전)·선회(수직 축 회전) 누적
  if (sp > 3 && !run.crumpled) {
    const ax2 = cross(fPrev, norm([p.vx, p.vy, p.vz]));
    run.pitchAcc = accumulate(run.pitchAcc, dot(ax2, rPrev), dt);
    run.yawAcc = accumulate(run.yawAcc, dot(ax2, UP), dt);
  }
}

// 같은 방향으로 계속 도는 동안만 누적한다. 반대 방향으로 뚜렷하게 돌면 거기서 다시 센다.
function accumulate(acc, d, dt) {
  if (acc * d < 0 && Math.abs(d) > 0.3 * dt) return d;
  return acc + d;
}

function boxesOf(b) {
  const out = [{ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, bot: 0, top: b.h, spire: false }];
  if (b.spire) out.push({ x0: b.spire.x0, x1: b.spire.x1, z0: b.spire.z0, z1: b.spire.z1, bot: b.h, top: b.h + b.spire.h, spire: true });
  return out;
}

// 옆벽·첨탑 충돌. 위에서 내려온 경우는 표면 접촉으로 따로 처리한다.
function collideWalls(run, prev, emit) {
  const p = run.p;
  const R = PHYS.R;
  for (const b of buildingsNear(run.world, p.x, p.z, 6)) {
    for (const r of boxesOf(b)) {
      if (p.x < r.x0 - R || p.x > r.x1 + R || p.z < r.z0 - R || p.z > r.z1 + R || p.y < r.bot || p.y > r.top) continue;
      if (prev.y >= r.top - 0.02) {
        if (!r.spire) continue; // 옥상 위 → 표면 처리
        p.y = r.top + R;
        p.vy = Math.abs(p.vy) * 0.3;
        hit(run, emit, 'spire');
        continue;
      }
      // 이전 위치가 어느 면 바깥이었는지로 부딪힌 면을 고른다
      const outX = prev.x < r.x0 - R || prev.x > r.x1 + R;
      const outZ = prev.z < r.z0 - R || prev.z > r.z1 + R;
      const useX = outX && (!outZ || Math.abs(p.vx) > Math.abs(p.vz));
      // 반사 + 최소 4m/s로 벽에서 떨어지게 해 벽면에 붙어 미끄러지지 않도록 한다
      if (useX) {
        const s = prev.x < (r.x0 + r.x1) / 2 ? -1 : 1;
        p.x = s < 0 ? r.x0 - R : r.x1 + R;
        p.vx = s * Math.max(4, Math.abs(p.vx) * 0.3);
        p.vz *= 0.6;
      } else {
        const s = prev.z < (r.z0 + r.z1) / 2 ? -1 : 1;
        p.z = s < 0 ? r.z0 - R : r.z1 + R;
        p.vz = s * Math.max(4, Math.abs(p.vz) * 0.3);
        p.vx *= 0.6;
      }
      if (run.phase === 'landed') {
        if (useX) p.vx = 0;
        else p.vz = 0;
        continue;
      }
      p.vy *= 0.6;
      hit(run, emit, r.spire ? 'spire' : 'wall');
    }
  }
}

function handleSurface(run, dt, emit) {
  const p = run.p;
  const b = buildingAt(run.world, p.x, p.z);
  const sh = (b ? b.h : 0) + PHYS.R;
  if (p.y <= sh + 0.02) {
    const impact = -p.vy;
    p.y = sh;
    if (p.vy < 0) p.vy = 0;
    const kind = b ? 'roof' : 'ground';
    if (run.touching !== kind || run.touchB !== b) {
      run.touching = kind;
      run.touchB = b;
      onTouchdown(run, kind, impact, emit);
    }
    // 수평 마찰
    const hs = Math.hypot(p.vx, p.vz);
    const fr = (kind === 'ground' ? 7 : 5) * dt;
    if (hs <= fr) {
      p.vx = 0;
      p.vz = 0;
    } else {
      const k = (hs - fr) / hs;
      p.vx *= k;
      p.vz *= k;
    }
    if (!run.crumpled && p.alpha < 0) p.alpha = 0;
  } else if (run.touching) {
    if (run.touching === 'roof' && run.phase === 'fly' && !run.crumpled && speedOf(p) > 10) {
      run.stats.touchGo++;
      award(run, 'touchGo', '터치 앤 고', POINTS.touchGo, emit);
    }
    run.touching = null;
    run.touchB = null;
  }
}

function onTouchdown(run, kind, impact, emit) {
  const p = run.p;
  emit('touch', { kind, impact, x: p.x, y: p.y, z: p.z });
  if (kind === 'roof') {
    if (impact > 11) hit(run, emit, 'roof');
    return;
  }
  // 지상 도착
  if (run.phase !== 'fly') return;
  run.phase = 'landed';
  run.phaseT = 0;
  flushStreaks(run, emit);
  if (run.crumpled) {
    run.landing = 'wreck';
    return;
  }
  const { nose } = attitude(p);
  const level = Math.abs(Math.asin(Math.max(-1, Math.min(1, nose[1])))) < 0.3 && Math.abs(p.bank) < 0.35;
  if (impact < 2.8 && level) {
    run.landing = 'perfect';
    award(run, 'perfect', '완벽한 착지', POINTS.perfect, emit);
  } else if (impact < 5.5) {
    run.landing = 'smooth';
    award(run, 'smooth', '부드러운 착지', POINTS.smooth, emit);
  } else {
    run.landing = 'rough';
  }
  emit('landed', { landing: run.landing, x: p.x, y: p.y, z: p.z });
}

function endSkim(run, emit) {
  if (run.skimT >= 0.5) {
    run.stats.skims++;
    award(run, 'skim', '옥상 스치기', 80 + run.skimT * 120, emit);
  }
  run.skimT = 0;
}

function endCanyon(run, emit) {
  if (run.canyonT >= 0.7) {
    run.stats.canyon++;
    award(run, 'canyon', '골목 질주', 60 + run.canyonT * 150, emit);
  }
  run.canyonT = 0;
}

function flushStreaks(run, emit) {
  endSkim(run, emit);
  endCanyon(run, emit);
}

// 점과 상자 사이 거리. beside = 수평으로 상자 바깥(옆)에 있는지
function boxDistance(p, r) {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dz = Math.max(r.z0 - p.z, 0, p.z - r.z1);
  const dy = Math.max(r.bot - p.y, 0, p.y - r.top);
  return { d: Math.hypot(dx, dy, dz), beside: dx > 0 || dz > 0 };
}

function judgeActions(run, dt, emit) {
  const p = run.p;
  const w = run.world;
  const sp = speedOf(p);

  // 아슬아슬: 벽·첨탑 옆을 2.2m 이내로 스쳐 지나감 (빌딩당 1회)
  if (sp > 12 && run.invuln <= 0) {
    for (const b of buildingsNear(w, p.x, p.z, 4)) {
      if (b.start || run.closeCalls.has(b.id)) continue;
      for (const r of boxesOf(b)) {
        const { d, beside } = boxDistance(p, r);
        if (beside && d < 2.2) {
          run.closeCalls.add(b.id);
          run.stats.closeCalls++;
          award(run, 'closeCall', '아슬아슬!', POINTS.closeCall, emit);
          break;
        }
      }
    }
  }

  // 옥상 스치기
  const b = buildingAt(w, p.x, p.z);
  const skimming = b && !b.start && !run.touching && p.y - b.h > PHYS.R + 0.05 && p.y - b.h < 4.5;
  if (skimming) run.skimT += dt;
  else if (run.skimT > 0) endSkim(run, emit);

  // 골목 질주: 낮게, 좌우 양쪽에 나보다 높은 빌딩
  let canyon = false;
  if (!b && !run.touching && p.y < 35 && p.z > 0 && p.z < CITY_END) {
    const rh = Math.hypot(p.r[0], p.r[2]) || 1;
    const rx = p.r[0] / rh, rz = p.r[2] / rh;
    let sides = 0;
    for (const s of [-1, 1]) {
      for (const dd of [8, 16, 24]) {
        const nb = buildingAt(w, p.x + rx * dd * s, p.z + rz * dd * s);
        if (nb && nb.h > p.y) {
          sides++;
          break;
        }
      }
    }
    canyon = sides === 2;
  }
  if (canyon) run.canyonT += dt;
  else if (run.canyonT > 0) endCanyon(run, emit);

  // 종이별
  for (const s of w.stars) {
    if (run.taken.has(s.id) || Math.abs(s.z - p.z) > 5) continue;
    if (Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) < 3.6) {
      run.taken.add(s.id);
      run.stats.stars++;
      emit('star', { x: s.x, y: s.y, z: s.z });
      award(run, 'star', '종이별', POINTS.star, emit);
    }
  }

  // 음속 종이
  if (sp > 42) run.speedT += dt;
  else if (run.speedT > 0) run.speedT = 0;
  if (run.speedT >= 1.2) {
    run.stats.speed++;
    award(run, 'speed', '음속 종이', POINTS.speed, emit);
    run.speedT = -3;
  } else if (run.speedT < 0) run.speedT = Math.min(0, run.speedT + dt);

  // 루프 / 360° 선회
  if (run.pitchAcc >= LOOP) {
    run.pitchAcc -= TAU;
    run.stats.loops++;
    award(run, 'loop', '루프!', POINTS.loop, emit);
  } else if (run.pitchAcc <= -LOOP) {
    run.pitchAcc += TAU;
    run.stats.loops++;
    award(run, 'loop', '역루프!', POINTS.loop, emit);
  }
  if (Math.abs(run.yawAcc) >= LOOP) {
    run.yawAcc -= Math.sign(run.yawAcc) * TAU;
    run.stats.turns++;
    award(run, 'turn', '360° 선회', POINTS.turn, emit);
  }
}

export function launch(run, emit = () => {}) {
  const sp = 12 + 24 * run.power;
  const p = run.p;
  p.vx = 0;
  p.vy = Math.sin(run.aim) * sp;
  p.vz = Math.cos(run.aim) * sp;
  p.f = norm([p.vx, p.vy, p.vz]);
  run.phase = 'fly';
  run.phaseT = 0;
  emit('launch', { speed: sp });
}

// input: { pitch: -1..1, roll: -1..1, tap } — tap은 이번 스텝에 새로 눌렸는지
export function step(run, input, dt, emit = () => {}) {
  run.phaseT += dt;
  if (run.phase === 'aim') {
    run.aim = -0.2 + 0.85 * (Math.sin(run.phaseT * 2.1 - Math.PI / 2) + 1) / 2;
    if (input.tap) {
      run.phase = 'power';
      run.phaseT = 0;
      emit('aimSet', {});
    }
    return;
  }
  if (run.phase === 'power') {
    run.power = (1 - Math.cos(run.phaseT * 3.2)) / 2;
    if (input.tap) launch(run, emit);
    return;
  }
  if (run.phase === 'done') return;

  const p = run.p;
  const prev = { x: p.x, y: p.y, z: p.z };
  run.invuln = Math.max(0, run.invuln - dt);
  flyPhysics(run, input, dt, emit);
  collideWalls(run, prev, emit);
  handleSurface(run, dt, emit);

  const sp = speedOf(p);
  if (run.phase === 'fly') {
    run.stats.maxSpeed = Math.max(run.stats.maxSpeed, sp);
    if (!run.touching) run.stats.airTime += dt;
    if (!run.crumpled) judgeActions(run, dt, emit);
    if (run.comboT > 0) {
      run.comboT -= dt;
      if (run.comboT <= 0) run.combo = 0;
    }
    // 옥상에 멈춰 섬
    if (run.touching === 'roof' && sp < 1.5) {
      run.stillT += dt;
      if (run.stillT > 1.2) {
        flushStreaks(run, emit);
        if (!run.crumpled && p.z > 30) {
          run.landing = 'roof';
          award(run, 'roofRest', '옥상 착륙', POINTS.roofRest, emit);
        } else run.landing = run.crumpled ? 'wreck' : 'roof';
        finish(run, 'roof', emit);
      }
    } else run.stillT = 0;
    // 안전장치: 비정상적으로 긴 비행
    if (run.phaseT > 600) finish(run, 'timeout', emit);
  } else if (run.phase === 'landed') {
    if (sp < 0.3 || run.phaseT > 8) {
      run.endT += dt;
      if (run.endT > 0.8) finish(run, run.crumpled ? 'wreck' : 'landed', emit);
    }
  }
}

function finish(run, reason, emit) {
  run.phase = 'done';
  run.endReason = reason;
  emit('done', { reason, score: totalScore(run), distance: distanceOf(run) });
}
