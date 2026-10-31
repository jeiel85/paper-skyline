import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, START_H, CELL, surfaceAt } from '../js/world.js';
import { createRun, step, launch, totalScore, distanceOf } from '../js/sim.js';
import { seedToCode, codeToSeed } from '../js/rng.js';

const DT = 1 / 120;

function fly(world, { aim = 0.15, power = 0.7, control = () => ({}) } = {}) {
  const run = createRun(world);
  const events = [];
  const emit = (type, data) => events.push({ type, ...data });
  run.aim = aim;
  run.power = power;
  launch(run, emit);
  let t = 0;
  while (run.phase !== 'done' && t < 400) {
    step(run, control(t, run), DT, emit);
    t += DT;
  }
  return { run, events, t };
}

function emptyWorld() {
  const w = createWorld(1);
  w.buildings = [w.start];
  w.grid = new Map();
  w.vents = [];
  w.stars = [];
  return w;
}

test('도시 코드는 시드와 왕복 변환된다', () => {
  for (const s of [0, 1, 42, 31 ** 5, 32 ** 5 - 1]) assert.equal(codeToSeed(seedToCode(s)), s);
  assert.equal(codeToSeed('abc'), null);
  assert.equal(codeToSeed('OOOOO'), null); // O·0·1·I 는 혼동 방지로 제외
});

test('같은 시드는 같은 도시를 만든다', () => {
  assert.deepEqual(createWorld(777).buildings, createWorld(777).buildings);
  assert.notDeepEqual(createWorld(777).buildings, createWorld(778).buildings);
});

test('빌딩은 자기 블록 안에 있고 서로 겹치지 않는다(도로가 남는다)', () => {
  for (let s = 0; s < 20; s++) {
    const w = createWorld(s);
    for (const b of w.buildings) {
      if (b.start) continue;
      const i = Math.round((b.x0 + b.x1) / 2 / CELL), k = Math.round((b.z0 + b.z1) / 2 / CELL);
      assert.ok(b.x0 > (i - 0.5) * CELL && b.x1 < (i + 0.5) * CELL, `seed ${s}: x 블록 이탈`);
      assert.ok(b.z0 > (k - 0.5) * CELL && b.z1 < (k + 0.5) * CELL, `seed ${s}: z 블록 이탈`);
      assert.ok(b.h > 0 && b.h < START_H);
    }
  }
});

test('입력 없이 활공하면 지상에 착지하고 시작 높이의 6배 이상 날아간다', () => {
  const { run } = fly(emptyWorld());
  assert.equal(run.endReason, 'landed');
  assert.ok(distanceOf(run) > START_H * 6, `distance ${distanceOf(run)}`);
  assert.ok(Math.abs(run.p.x) < 1, '무입력이면 옆으로 새지 않는다');
});

test('다이브 후 풀업하면 루프 점수를 받는다', () => {
  const { run, events } = fly(emptyWorld(), {
    aim: 0.1, power: 0.6,
    control: (t) => ({ pitch: t > 2 && t < 4 ? -1 : t >= 4 && t < 9 ? 1 : 0 }), // 2초 다이브로 속도를 모은 뒤 풀업
  });
  assert.ok(run.stats.loops >= 1, `loops ${run.stats.loops}`);
  assert.ok(events.some((e) => e.type === 'award' && e.key === 'loop'));
});

test('뱅크를 유지하면 선회하고 360° 선회 점수를 받는다', () => {
  const { run } = fly(emptyWorld(), {
    aim: 0.1, power: 0.8,
    control: (t) => ({ roll: t > 1 && t < 25 ? 1 : 0, pitch: t > 1 && t < 25 ? 0.6 : 0 }),
  });
  assert.ok(run.stats.turns >= 1, `turns ${run.stats.turns}`);
});

test('넘을 수 없는 벽에 부딪히면 구겨지고, 점수는 거리 + 액션 합이다', () => {
  const w = emptyWorld();
  const wall = { id: 1, x0: -20, x1: 20, z0: 30, z1: 60, h: 450, start: false, spire: null, tint: 0 };
  w.buildings.push(wall);
  w.grid.set(1, wall); // 블록 (0, 1)
  const { run, events } = fly(w, { aim: 0, power: 1 });
  assert.ok(events.filter((e) => e.type === 'hit').length >= 1);
  assert.equal(run.phase, 'done');
  const sum = run.awards.reduce((s, a) => s + a.pts, 0);
  assert.equal(totalScore(run), distanceOf(run) + sum);
});

test('여러 시드에서 무입력 비행이 항상 종료되고 지면을 뚫지 않는다', () => {
  for (let s = 0; s < 25; s++) {
    const { run, t } = fly(createWorld(s));
    assert.equal(run.phase, 'done', `seed ${s} did not finish`);
    assert.ok(Number.isFinite(totalScore(run)));
    assert.ok(t < 400);
    assert.ok(run.p.y >= surfaceAt(run.world, run.p.x, run.p.z) - 0.01, `seed ${s}: 지면 아래로 뚫고 들어감`);
  }
});
