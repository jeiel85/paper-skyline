// 3D 도시 생성: 시작 타워 → 격자형 빌딩 숲(앞으로 갈수록 낮아짐) → 교외 평지
// 좌표계: x = 좌우, y = 위, z = 전진 방향(m)
import { mulberry32 } from './rng.js';

export const START_H = 320; // 시작 타워 높이(m)
export const CELL = 44; // 블록 간격(m). 블록 경계가 도로가 된다
export const LANES = 6; // 중앙 대로 기준 좌우 블록 수
export const CITY_END = 6000; // 이 지점 이후는 빌딩이 없는 평지

export const PALETTES = [
  {
    name: '노을',
    sky: ['#1d2550', '#53407a', '#c9677a', '#f4a76a', '#fbd59a'],
    sun: '#ffe2a8', sunDir: [0.35, 0.18, 1], stars: 0.15,
    fog: '#d98a86', body: ['#3a3760', '#433a66', '#34405f', '#4a3a62'], far: '#5a4a7c',
    edge: '#ffb199', win: '#ffd27a', winOff: '#232241', litRate: 0.35, light: 0.75,
    ground: '#2a2638', street: '#1b1a2a', line: '#e6b98a', cloud: '#ffc2b0',
  },
  {
    name: '한밤',
    sky: ['#02040f', '#060c26', '#0e1c45', '#1d3570'],
    sun: '#eef3ff', sunDir: [-0.4, 0.55, 1], stars: 1,
    fog: '#101b3d', body: ['#141c38', '#19213f', '#121a33', '#1c2140'], far: '#0f1838',
    edge: '#6f8cff', win: '#ffe6a0', winOff: '#0b1129', litRate: 0.5, light: 0.35,
    ground: '#080b1c', street: '#05070f', line: '#5d6fb0', cloud: '#2a3a70',
  },
  {
    name: '맑은 낮',
    sky: ['#3f8fe0', '#6fb3ef', '#a8d6f7', '#e3f3ff'],
    sun: '#fffbe6', sunDir: [0.5, 0.75, 0.6], stars: 0,
    fog: '#bcdcf5', body: ['#7d8fb1', '#8a9cbd', '#6f80a3', '#97a5c0'], far: '#9db8d8',
    edge: '#ffffff', win: '#e8f6ff', winOff: '#4b6288', litRate: 0.25, light: 1,
    ground: '#7d8a76', street: '#5d6470', line: '#f2f2f2', cloud: '#ffffff',
  },
];

const key = (i, k) => i * 100000 + k;

export function createWorld(seed) {
  const rand = mulberry32(seed);
  const palette = Math.floor(rand() * PALETTES.length);
  const buildings = [];
  const grid = new Map();
  const vents = [];
  const stars = [];

  const start = { id: 0, x0: -18, x1: 18, z0: -40, z1: 0, h: START_H, start: true, spire: null, tint: 0 };
  buildings.push(start);

  let id = 1;
  const rows = Math.floor(CITY_END / CELL);
  const ventRows = new Set();
  for (let k = 1; k <= rows; k++) {
    const zc = k * CELL;
    // 입력 없이 활공했을 때의 대략적인 고도선보다 낮게 → 기본적으로 지나갈 수 있는 도시
    const glide = START_H - zc / 5.4;
    const ceil = Math.max(26, glide * 0.82);
    for (let i = -LANES; i <= LANES; i++) {
      // 중앙 대로는 대부분 비워 둔다
      if (i === 0 && rand() < 0.6) continue;
      if (rand() < 0.1) continue; // 공원·광장
      const margin = 5 + rand() * 6;
      const w = CELL - margin * 2 - rand() * 8;
      const d = CELL - margin * 2 - rand() * 8;
      const cx = i * CELL + (rand() - 0.5) * (CELL - margin * 2 - w);
      const cz = zc + (rand() - 0.5) * (CELL - margin * 2 - d);
      let h;
      if (ventRows.has(key(i, k - 1)) && rand() < 0.6) {
        // 상승기류 바로 뒤의 '도전 타워': 기류를 타야 넘기 쉽다
        h = Math.min(START_H * 0.92, ceil + 15 + rand() * 25);
      } else {
        const r = rand();
        h = 18 + (r * r * 0.5 + rand() * 0.5) * Math.max(10, ceil - 18);
        h *= 1 + Math.abs(i) * 0.04; // 바깥 블록은 조금 더 높게 → 숲 같은 벽
        h = Math.min(h, START_H * 0.9);
      }
      const b = { id: id++, x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, h, start: false, spire: null, tint: Math.floor(rand() * 4) };
      if (rand() < 0.15) {
        const s = 1.6;
        const sx = cx + (rand() - 0.5) * w * 0.5, sz = cz + (rand() - 0.5) * d * 0.5;
        b.spire = { x0: sx - s / 2, x1: sx + s / 2, z0: sz - s / 2, z1: sz + s / 2, h: 12 + rand() * 24 };
      } else if (rand() < 0.07) {
        vents.push({ x: cx, z: cz, top: h, height: 120, sigma: 14, strength: 26 });
        ventRows.add(key(i, k));
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

  return { seed, palette, buildings, grid, vents, stars, start };
}

function inBox(b, x, z, pad = 0) {
  return x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad;
}

export function buildingAt(world, x, z) {
  if (inBox(world.start, x, z)) return world.start;
  const b = world.grid.get(key(Math.round(x / CELL), Math.round(z / CELL)));
  return b && inBox(b, x, z) ? b : null;
}

export function surfaceAt(world, x, z) {
  const b = buildingAt(world, x, z);
  return b ? b.h : 0;
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
