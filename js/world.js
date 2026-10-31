// 3D 도시 생성: 시작 타워 → 격자형 빌딩 숲(앞으로 갈수록 낮아짐) → 교외 평지
// 좌표계: x = 좌우, y = 위, z = 전진 방향(m)
import { mulberry32 } from './rng.js';

export const START_H = 320; // 시작 타워 높이(m)
export const CELL = 44; // 블록 간격(m). 블록 경계가 도로가 된다
export const LANES = 6; // 중앙 대로 기준 좌우 블록 수
export const CITY_END = 6000; // 이 지점 이후는 빌딩이 없는 평지

// 외벽 스타일 (렌더러 셰이더와 공유하는 번호)
export const STYLE = { GRID: 0, RIBBON: 1, FINS: 2, GLASS: 3, BRICK: 4, PLAIN: 5, BOARD: 6 };

// mats[스타일] = 그 스타일에 어울리는 외벽 색 후보
export const PALETTES = [
  {
    name: '노을',
    sky: ['#1d2550', '#53407a', '#c9677a', '#f4a76a', '#fbd59a'],
    sun: '#ffe2a8', sunDir: [0.35, 0.18, 1], stars: 0.15,
    fog: '#d98a86', far: '#5a4a7c',
    mats: [
      ['#3a3760', '#5b4a6e', '#2f3b52', '#6a5a6a'],
      ['#8a7a8c', '#6e6580', '#9a8070', '#5e6a80'],
      ['#b0a0a8', '#7a6a82', '#c2a89a', '#9a9aa8'],
      ['#2b4a6e', '#1f5a6a', '#3b3f73', '#2a3550'],
      ['#7a4a46', '#6b4a3a', '#86564a', '#5e4048'],
      ['#55506e', '#4a4660', '#5e5470', '#504a64'],
    ],
    edge: '#ffb199', win: '#ffd27a', winOff: '#232241', glassSky: '#e8907e', litRate: 0.35, light: 0.75,
    ground: '#2a2638', street: '#1b1a2a', line: '#e6b98a', cloud: '#ffc2b0', park: '#3f4a3a', plaza: '#4a4252', leaf: '#4f6b45',
    boards: ['#ff6b81', '#7bdff2', '#ffd166', '#b28dff', '#06d6a0'],
  },
  {
    name: '한밤',
    sky: ['#02040f', '#060c26', '#0e1c45', '#1d3570'],
    sun: '#eef3ff', sunDir: [-0.4, 0.55, 1], stars: 1,
    fog: '#101b3d', far: '#0f1838',
    mats: [
      ['#141c38', '#19213f', '#121a33', '#1c2140'],
      ['#2e3550', '#3a3048', '#283a48', '#34344a'],
      ['#3d3a52', '#2c3446', '#45384a', '#383e56'],
      ['#0f2a4a', '#0a3a44', '#1b1a3e', '#0e1e38'],
      ['#3a2224', '#30241e', '#3d2a26', '#2c1f26'],
      ['#1d2036', '#191c30', '#22233a', '#1b1e34'],
    ],
    edge: '#6f8cff', win: '#ffe6a0', winOff: '#0b1129', glassSky: '#2a4a8a', litRate: 0.5, light: 0.35,
    ground: '#080b1c', street: '#05070f', line: '#5d6fb0', cloud: '#2a3a70', park: '#0c1a14', plaza: '#121428', leaf: '#163024',
    boards: ['#ff2e63', '#08d9d6', '#ffd23f', '#a259ff', '#00f5a0'],
  },
  {
    name: '맑은 낮',
    sky: ['#3f8fe0', '#6fb3ef', '#a8d6f7', '#e3f3ff'],
    sun: '#fffbe6', sunDir: [0.5, 0.75, 0.6], stars: 0,
    fog: '#bcdcf5', far: '#9db8d8',
    mats: [
      ['#7d8fb1', '#8a9cbd', '#a3aec4', '#97a5c0'],
      ['#c9ced8', '#b8c0cc', '#d6d0c2', '#c2c6cf'],
      ['#e2dccd', '#9aa3b5', '#c4b8a6', '#b3b9c6'],
      ['#4f7fae', '#3f6f98', '#5d9ab8', '#557099'],
      ['#a0624f', '#8e5a4a', '#b07b5e', '#9b6b58'],
      ['#b9bec9', '#a9afbb', '#c7c2b8', '#b0b5bf'],
    ],
    edge: '#ffffff', win: '#8fa6c0', winOff: '#34496b', glassSky: '#cfe8ff', litRate: 0.12, light: 1,
    ground: '#7d8a76', street: '#5d6470', line: '#f2f2f2', cloud: '#ffffff', park: '#6f9a5a', plaza: '#b9b2a4', leaf: '#4f8a46',
    boards: ['#ff5d73', '#3fa7d6', '#fac05e', '#7c6ee6', '#2ec4b6'],
  },
];

const key = (i, k) => i * 100000 + k;

function part(x0, x1, z0, z1, bot, top, kind) {
  return { x0, x1, z0, z1, bot, top, kind };
}

// 높이에 따라 어울리는 외벽 스타일을 고른다 (벽돌은 낮은 건물, 유리는 높은 건물 위주)
function pickStyle(rand, h) {
  const r = rand();
  if (h < 60) return r < 0.4 ? STYLE.BRICK : r < 0.65 ? STYLE.GRID : r < 0.85 ? STYLE.RIBBON : STYLE.FINS;
  if (h > 140) return r < 0.4 ? STYLE.GLASS : r < 0.6 ? STYLE.FINS : r < 0.8 ? STYLE.RIBBON : STYLE.GRID;
  return r < 0.25 ? STYLE.GLASS : r < 0.5 ? STYLE.GRID : r < 0.7 ? STYLE.RIBBON : r < 0.85 ? STYLE.FINS : STYLE.BRICK;
}

// 한 블록의 건물: 몸체(일반/계단식/포디움) + 옥상 구조물 하나 + 실외기 장식
function makeBuilding(rand, id, cx, cz, w, d, h, opts = {}) {
  const style = pickStyle(rand, h);
  const b = {
    id, x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, h,
    start: false, style, tint: Math.floor(rand() * 4), seed: rand(),
    parts: [], decor: [], vent: null, board: 0,
  };
  const shape = opts.shape ?? (h > 90 && rand() < 0.35 ? 'setback' : h > 60 && rand() < 0.25 ? 'podium' : 'box');
  let top; // 맨 위 덩어리
  if (shape === 'setback') {
    // 위로 갈수록 좁아지는 2~3단
    const tiers = rand() < 0.5 ? 2 : 3;
    let x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1, bot = 0;
    for (let t = 0; t < tiers; t++) {
      const tt = t === tiers - 1 ? h : bot + (h - bot) * (0.45 + rand() * 0.2);
      top = part(x0, x1, z0, z1, bot, tt, 'body');
      b.parts.push(top);
      const kx = (x1 - x0) * (0.12 + rand() * 0.1), kz = (z1 - z0) * (0.12 + rand() * 0.1);
      x0 += kx; x1 -= kx; z0 += kz; z1 -= kz;
      bot = tt;
    }
  } else if (shape === 'podium') {
    // 넓고 낮은 저층부 위에 날씬한 타워
    const ph = 10 + rand() * 12;
    b.parts.push(part(b.x0, b.x1, b.z0, b.z1, 0, ph, 'podium'));
    const tw = w * (0.45 + rand() * 0.2), td = d * (0.45 + rand() * 0.2);
    const ox = (rand() - 0.5) * (w - tw), oz = (rand() - 0.5) * (d - td);
    top = part(cx + ox - tw / 2, cx + ox + tw / 2, cz + oz - td / 2, cz + oz + td / 2, ph, h, 'body');
    b.parts.push(top);
  } else {
    top = part(b.x0, b.x1, b.z0, b.z1, 0, h, 'body');
    b.parts.push(top);
  }

  // 옥상 구조물 (하나만)
  const tw = top.x1 - top.x0, td = top.z1 - top.z0;
  const tx = (top.x0 + top.x1) / 2, tz = (top.z0 + top.z1) / 2;
  const at = (fx, fz) => [top.x0 + tw * fx, top.z0 + td * fz];
  const r = rand();
  if (r < 0.14 && !opts.noSpire) {
    const s = 1.6;
    const [sx, sz] = at(0.3 + rand() * 0.4, 0.3 + rand() * 0.4);
    b.parts.push(part(sx - s / 2, sx + s / 2, sz - s / 2, sz + s / 2, h, h + 12 + rand() * 24, 'spire'));
  } else if (r < 0.21) {
    b.vent = { x: tx, z: tz, top: h, height: 120, sigma: 14, strength: 26 };
  } else if (r < 0.43) {
    // 펜트하우스·기계실
    const pw = tw * (0.3 + rand() * 0.25), pd = td * (0.3 + rand() * 0.25);
    const [px, pz] = at(0.3 + rand() * 0.4, 0.3 + rand() * 0.4);
    b.parts.push(part(px - pw / 2, px + pw / 2, pz - pd / 2, pz + pd / 2, h, h + 3 + rand() * 3, 'cap'));
  } else if (r < 0.58) {
    // 물탱크 (충돌은 상자, 그림은 원통)
    const [px, pz] = at(0.25 + rand() * 0.5, 0.25 + rand() * 0.5);
    b.parts.push(part(px - 1.8, px + 1.8, pz - 1.8, pz + 1.8, h, h + 6, 'tank'));
  } else if (r < 0.66 && h < 140) {
    // 옥상 광고판: 진행 방향(z)을 바라보는 얇은 판
    const bw = Math.min(tw * 0.8, 14 + rand() * 8);
    b.parts.push(part(tx - bw / 2, tx + bw / 2, tz - 0.4, tz + 0.4, h, h + 7 + rand() * 3, 'board'));
    b.board = Math.floor(rand() * 5);
  } else if (r < 0.75 && tw > 16 && td > 16) {
    b.decor.push({ type: 'helipad', x: tx, y: h, z: tz, w: Math.min(tw, td) * 0.7 });
  } else if (r < 0.85 && tw > 12 && td > 12) {
    b.decor.push({ type: 'garden', x: tx, y: h, z: tz, w: tw * 0.75, d: td * 0.75 });
    for (let t = 0; t < 3; t++) {
      const [gx, gz] = at(0.2 + rand() * 0.6, 0.2 + rand() * 0.6);
      b.decor.push({ type: 'tree', x: gx, y: h, z: gz, s: 1.2 + rand() * 0.8 });
    }
  }
  // 실외기: 작고 낮아 충돌 없이 장식만
  const ac = Math.floor(rand() * 4);
  for (let i = 0; i < ac; i++) {
    const [ax, az] = at(0.12 + rand() * 0.76, 0.12 + rand() * 0.76);
    b.decor.push({ type: 'ac', x: ax, y: h, z: az });
  }
  return b;
}

export function createWorld(seed) {
  const rand = mulberry32(seed);
  const palette = Math.floor(rand() * PALETTES.length);
  const buildings = [];
  const grid = new Map();
  const vents = [];
  const stars = [];
  const parks = []; // 빈 블록: 공원(나무) 또는 광장
  const trees = [];

  const start = {
    id: 0, x0: -18, x1: 18, z0: -40, z1: 0, h: START_H, start: true, style: STYLE.GLASS, tint: 1, seed: 0.5,
    parts: [part(-18, 18, -40, 0, 0, START_H, 'body')],
    decor: [{ type: 'helipad', x: 0, y: START_H, z: -22, w: 22 }],
    vent: null, board: 0,
  };
  buildings.push(start);

  let id = 1;
  const rows = Math.floor(CITY_END / CELL);
  const ventCells = new Set();
  for (let k = 1; k <= rows; k++) {
    const zc = k * CELL;
    // 입력 없이 활공했을 때의 대략적인 고도선보다 낮게 → 기본적으로 지나갈 수 있는 도시
    const glide = START_H - zc / 5.4;
    const ceil = Math.max(26, glide * 0.82);
    for (let i = -LANES; i <= LANES; i++) {
      // 중앙 대로는 대부분 광장, 나머지 블록은 가끔 공원
      const empty = i === 0 ? rand() < 0.6 : rand() < 0.1;
      if (empty) {
        const kind = i === 0 ? 'plaza' : 'park';
        const m = 6.5;
        parks.push({ x0: i * CELL - CELL / 2 + m, x1: i * CELL + CELL / 2 - m, z0: zc - CELL / 2 + m, z1: zc + CELL / 2 - m, kind });
        if (kind === 'park') {
          const n = 4 + Math.floor(rand() * 6);
          for (let t = 0; t < n; t++) trees.push({ x: i * CELL + (rand() - 0.5) * (CELL - 18), y: 0, z: zc + (rand() - 0.5) * (CELL - 18), s: 2.2 + rand() * 1.8 });
        }
        continue;
      }
      const margin = 5 + rand() * 6;
      const w = CELL - margin * 2 - rand() * 8;
      const d = CELL - margin * 2 - rand() * 8;
      const cx = i * CELL + (rand() - 0.5) * (CELL - margin * 2 - w);
      const cz = zc + (rand() - 0.5) * (CELL - margin * 2 - d);
      let h;
      let opts = {};
      if (ventCells.has(key(i, k - 1)) && rand() < 0.6) {
        // 상승기류 바로 뒤의 '도전 타워': 기류를 타야 넘기 쉽다
        h = Math.min(START_H * 0.92, ceil + 15 + rand() * 25);
        opts = { shape: 'setback', noSpire: true };
      } else {
        const r = rand();
        h = 18 + (r * r * 0.5 + rand() * 0.5) * Math.max(10, ceil - 18);
        h *= 1 + Math.abs(i) * 0.04; // 바깥 블록은 조금 더 높게 → 숲 같은 벽
        h = Math.min(h, START_H * 0.9);
      }
      const b = makeBuilding(rand, id++, cx, cz, w, d, h, opts);
      if (b.vent) {
        vents.push(b.vent);
        ventCells.add(key(i, k));
      }
      buildings.push(b);
      grid.set(key(i, k), b);
    }
    // 종이별: 도로 위 낮은 곳(위험) 또는 옥상 위 높은 곳
    if (rand() < 0.55) {
      const i = Math.floor(rand() * 7) - 3;
      const low = rand() < 0.55;
      const sx = (i + 0.5) * CELL;
      const sz = zc + CELL / 2;
      const y = low ? 8 + rand() * Math.min(40, ceil * 0.5) : ceil * (0.7 + rand() * 0.4) + 10;
      stars.push({ id: stars.length, x: sx, y: Math.min(y, START_H - 10), z: sz });
    }
  }

  return { seed, palette, buildings, grid, vents, stars, start, parks, trees };
}

function inBox(b, x, z, pad = 0) {
  return x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad;
}

export function buildingAt(world, x, z) {
  if (inBox(world.start, x, z)) return world.start;
  const b = world.grid.get(key(Math.round(x / CELL), Math.round(z / CELL)));
  return b && inBox(b, x, z) ? b : null;
}

// 빌딩 b의 (x,z) 지점 옥상 높이: 그 위치를 덮는 덩어리 중 가장 높은 것 (첨탑 제외)
export function roofAt(b, x, z) {
  let top = 0;
  for (const p of b.parts) if (p.kind !== 'spire' && inBox(p, x, z) && p.top > top) top = p.top;
  return top;
}

export function surfaceAt(world, x, z) {
  const b = buildingAt(world, x, z);
  return b ? roofAt(b, x, z) : 0;
}

// (x,z) 주변 r 이내 블록의 빌딩들
export function buildingsNear(world, x, z, r) {
  const out = [];
  const i0 = Math.round((x - r) / CELL), i1 = Math.round((x + r) / CELL);
  const k0 = Math.round((z - r) / CELL), k1 = Math.round((z + r) / CELL);
  for (let i = i0; i <= i1; i++) {
    for (let k = k0; k <= k1; k++) {
      const b = world.grid.get(key(i, k));
      if (b) out.push(b);
    }
  }
  if (z < 40 + r && Math.abs(x) < 60 + r) out.push(world.start);
  return out;
}
