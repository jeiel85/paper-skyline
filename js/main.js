import { createWorld, PALETTES } from './world.js';
import { createRun, step, totalScore, distanceOf, comboMult, speedOf } from './sim.js';
import { Renderer3D } from './render3d.js';
import { Sound } from './audio.js';
import { seedToCode, codeToSeed, randomSeed, challengeTag } from './rng.js';
import { drawScoreCard, canvasToBlob, nativeShare, copyText, downloadBlob, xIntentUrl, challengeUrl, shareText } from './share.js';

const $ = (id) => document.getElementById(id);
const DT = 1 / 120;

// ---------- 저장소 (사생활 보호 모드 등에서 실패해도 게임은 동작) ----------
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('paperSkyline.' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('paperSkyline.' + k, JSON.stringify(v)); } catch { /* 저장 불가 환경: 기록만 유지 안 됨 */ }
  },
};

// ---------- 상태 ----------
const params = new URLSearchParams(location.search);
const urlSeed = codeToSeed(params.get('city'));
// 챌린지 점수는 확인 태그(v)가 맞을 때만 믿는다. 서버 검증이 아니라 주소창에서 숫자만 바꾸는 장난을 막는 수준이다.
const rawChallenge = urlSeed != null && /^\d{1,7}$/.test(params.get('c') || '') ? Number(params.get('c')) : null;
const challengeOk = rawChallenge != null && params.get('v') === challengeTag(seedToCode(urlSeed), rawChallenge);
const challengeScore = challengeOk ? rawChallenge : null;
const challengeTampered = rawChallenge != null && !challengeOk;
// 디버그 훅은 로컬 개발 서버나 ?debug 에서만 연다. 훅을 쓴 판의 기록은 저장하지 않는다.
const DEBUG = params.has('debug') || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let debugTouched = false;

let seed = urlSeed ?? randomSeed();
let world = createWorld(seed);
let run = createRun(world);
let mode = 'title'; // title | play | paused | result
let time = 0;
let acc = 0;
let last = performance.now();
let lastResult = null;
let shareBlob = null;
let snapshot = null;

// 저사양 기기 추정: 터치 기기이면서 메모리·코어가 적으면 처음부터 낮은 품질로 시작
function initialQuality() {
  const saved = store.get('quality', null);
  if (saved === 'high' || saved === 'low') return saved;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  return coarse && weak ? 'low' : 'high';
}

let renderer;
try {
  renderer = new Renderer3D($('game'), initialQuality());
} catch (e) {
  $('nogl').classList.remove('hidden');
  throw e;
}
const fx = { trail: [], particles: [] };
const sound = new Sound();
sound.muted = store.get('muted', false);

// 조작 상태: 키보드 + 드래그 스틱(마우스·터치 공통)
const input = { pitch: 0, roll: 0, tap: false };
const keys = { up: false, down: false, left: false, right: false };
const stick = { id: null, x0: 0, y0: 0, dx: 0, dy: 0 };

// ---------- 이벤트 → 연출 ----------
const AWARD_COLORS = { loop: '#ff8fa3', turn: '#ff8fa3', perfect: '#7dffb2', star: '#ffe27a', touchGo: '#8fd3ff', canyon: '#c9a2ff', skim: '#8fd3ff', closeCall: '#ffcf6e', thermal: '#a8f0ff', speed: '#ff9f6e', smooth: '#7dffb2', roofRest: '#7dffb2' };
const popLayer = $('popups');
const popups = [];

function popup(d) {
  const el = document.createElement('div');
  el.className = 'pop';
  el.style.color = AWARD_COLORS[d.key] || '#fff';
  el.textContent = `${d.label} +${d.pts}`;
  popLayer.appendChild(el);
  popups.push({ el, x: d.x, y: d.y, z: d.z, life: 1.4, max: 1.4 });
}

function emit(type, d) {
  switch (type) {
    case 'award':
      popup(d);
      sound.award(run.combo);
      if (navigator.vibrate && d.pts >= 300) try { navigator.vibrate(20); } catch { /* 미지원 */ }
      break;
    case 'star':
      sound.star();
      burst(d, 18, [1, 0.9, 0.55], 10);
      break;
    case 'hit':
      sound.hit();
      renderer.cam.shake = 0.8;
      burst(d, 14, [0.96, 0.95, 0.9], 7);
      toast(d.left > 0 ? `종이가 구겨졌다! (남은 내구도 ${d.left})` : '');
      break;
    case 'wreck':
      sound.wreck();
      renderer.cam.shake = 1.2;
      burst(d, 30, [0.96, 0.95, 0.9], 10);
      break;
    case 'touch':
      if (d.impact > 2) burst(d, 8, [0.85, 0.85, 0.9], 4);
      break;
    case 'landed':
      sound.land(d.landing);
      burst(d, 20, [0.9, 0.9, 0.95], 6);
      break;
    case 'launch':
      sound.launch();
      break;
    case 'aimSet':
      sound.click();
      break;
    case 'done':
      setTimeout(showResult, 600);
      break;
  }
}

function burst(at, n, color, speed) {
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const v = speed * (0.4 + Math.random());
    fx.particles.push({ x: at.x, y: at.y, z: at.z, vx: s * Math.cos(a) * v, vy: u * v, vz: s * Math.sin(a) * v, life: 0.8 + Math.random() * 0.6, max: 1.4, color });
  }
}

function updateFx(dt) {
  for (const q of fx.particles) {
    q.life -= dt;
    q.vy -= 6 * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.z += q.vz * dt;
  }
  fx.particles = fx.particles.filter((q) => q.life > 0);
  if (run.phase === 'fly' || run.phase === 'landed') {
    const p = run.p;
    const lt = fx.trail[fx.trail.length - 1];
    if (!lt || Math.hypot(lt.x - p.x, lt.y - p.y, lt.z - p.z) > 1.5) fx.trail.push({ x: p.x, y: p.y, z: p.z });
    if (fx.trail.length > 90) fx.trail.shift();
  }
}

function updatePopups(dt) {
  for (let i = popups.length - 1; i >= 0; i--) {
    const q = popups[i];
    q.life -= dt;
    if (q.life <= 0) {
      q.el.remove();
      popups.splice(i, 1);
      continue;
    }
    const s = renderer.project(q.x, q.y + 1.5, q.z);
    if (!s) {
      q.el.style.opacity = '0';
      continue;
    }
    const t = 1 - q.life / q.max;
    q.el.style.opacity = String(Math.min(1, (q.life / q.max) * 2.5));
    q.el.style.transform = `translate(${s.x}px, ${s.y - 30 - t * 50}px) translate(-50%, -50%)`;
  }
}

function clearPopups() {
  for (const q of popups) q.el.remove();
  popups.length = 0;
}

// ---------- 화면 전환 ----------
const screens = ['title', 'how', 'pause', 'result', 'share'];
function show(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
}

function newRun(newSeed) {
  if (newSeed != null && newSeed !== seed) {
    seed = newSeed;
    world = createWorld(seed);
    renderer.setWorld(world);
  } else if (renderer.builtQuality !== renderer.quality) {
    // 비행 중 품질이 낮아졌다면 다음 판부터 장식 수도 줄인다
    renderer.setWorld(world);
  }
  debugTouched = false;
  run = createRun(world);
  fx.trail = [];
  fx.particles = [];
  clearPopups();
  renderer.resetCamera(run);
  refreshTitle();
}

function refreshTitle() {
  const code = seedToCode(seed);
  $('cityCode').textContent = code;
  $('cityPal').textContent = PALETTES[world.palette].name;
  $('bestScore').textContent = store.get('best', 0).toLocaleString('ko-KR');
  const ch = $('challenge');
  if (challengeScore != null && urlSeed === seed) {
    ch.innerHTML = `🎯 친구가 도시 <b>#${code}</b>에서 <b>${challengeScore.toLocaleString('ko-KR')}점</b>을 기록했어요.<br/>이 기록을 넘어 보세요!`;
    ch.classList.remove('hidden');
  } else if (challengeTampered && urlSeed === seed) {
    ch.textContent = `링크의 점수 정보가 올바르지 않아 도시 #${code}만 불러왔어요.`;
    ch.classList.remove('hidden');
  } else ch.classList.add('hidden');
}

function startPlay() {
  sound.unlock();
  show(null);
  $('hud').classList.remove('hidden');
  mode = 'play';
  run.phaseT = 0;
  last = performance.now();
}

function pause() {
  if (mode !== 'play') return;
  mode = 'paused';
  sound.setWind(0, false);
  show('pause');
}

function resume() {
  if (mode !== 'paused' || glLost) return;
  sound.resume();
  show(null);
  mode = 'play';
  last = performance.now();
}

function goTitle() {
  mode = 'title';
  $('hud').classList.add('hidden');
  sound.setWind(0, false);
  newRun();
  show('title');
}

function showResult() {
  if (mode !== 'play' || run.phase !== 'done') return;
  snapshot = renderer.capture({ run, fx, time });
  mode = 'result';
  sound.setWind(0, false);
  $('hud').classList.add('hidden');
  resetStick();
  clearPopups();
  const score = totalScore(run);
  const distance = distanceOf(run);
  const code = seedToCode(seed);
  const best = store.get('best', 0);
  const isBest = score > best && !debugTouched;
  if (isBest) store.set('best', score);
  const cityKey = 'city.' + code;
  const cityBest = store.get(cityKey, 0);
  if (score > cityBest && !debugTouched) store.set(cityKey, score);

  const reasons = {
    landed: { perfect: '🛬 완벽한 착지!', smooth: '🛬 지상에 무사히 도착', rough: '🛬 쿵! 거칠게 도착' },
    roof: '🏢 옥상에 내려앉았다',
    wreck: '💥 종이가 완전히 구겨졌다',
    timeout: '⏱ 비행 시간 초과',
  };
  const rs = reasons[run.endReason];
  $('resReason').textContent = typeof rs === 'object' ? rs[run.landing] || rs.rough : rs || '';
  $('resScore').textContent = score.toLocaleString('ko-KR');
  $('resBest').classList.toggle('hidden', !isBest);
  $('resSub').textContent = `도시 #${code} · ${distance.toLocaleString('ko-KR')}m · 최고 속도 ${Math.round(run.stats.maxSpeed * 3.6)}km/h · 도시 최고 ${Math.max(score, cityBest).toLocaleString('ko-KR')}`;

  const chEl = $('resChallenge');
  if (challengeScore != null && urlSeed === seed) {
    chEl.textContent = score > challengeScore
      ? `🎉 친구 기록 ${challengeScore.toLocaleString('ko-KR')}점을 ${(score - challengeScore).toLocaleString('ko-KR')}점 차로 넘었어요!`
      : `친구 기록까지 ${(challengeScore - score).toLocaleString('ko-KR')}점 남았어요. 한 번 더!`;
    chEl.classList.remove('hidden');
  } else chEl.classList.add('hidden');

  // 액션별 합계
  const groups = new Map();
  for (const a of run.awards) {
    const gr = groups.get(a.label) || { n: 0, pts: 0 };
    gr.n++;
    gr.pts += a.pts;
    groups.set(a.label, gr);
  }
  const ul = $('resBreakdown');
  ul.innerHTML = '';
  const li = (label, value, cls) => {
    const el = document.createElement('li');
    if (cls) el.className = cls;
    const sp = document.createElement('span');
    sp.textContent = label;
    const b = document.createElement('b');
    b.textContent = value;
    el.append(sp, b);
    ul.appendChild(el);
  };
  li('비행 거리', `${distance.toLocaleString('ko-KR')}`);
  [...groups.entries()].sort((a, b) => b[1].pts - a[1].pts).forEach(([label, gr]) => li(`${label}${gr.n > 1 ? ` ×${gr.n}` : ''}`, `+${gr.pts.toLocaleString('ko-KR')}`));
  li('합계', score.toLocaleString('ko-KR'), 'total');

  lastResult = {
    code, score, distance, isBest,
    palette: world.palette,
    loops: run.stats.loops,
    stars: run.stats.stars,
    actions: run.awards.length,
    landing: run.endReason === 'landed' ? run.landing : run.endReason === 'roof' ? 'roof' : 'wreck',
  };
  shareBlob = null;
  show('result');
}

async function openShare() {
  if (!lastResult) return;
  const cv = await drawScoreCard(lastResult, snapshot);
  $('sharePreview').src = cv.toDataURL('image/png');
  const url = challengeUrl(lastResult.code, lastResult.score);
  const text = shareText(lastResult);
  $('shareTextPreview').textContent = `${text}\n${url}`;
  $('btnX').href = xIntentUrl(text, url);
  $('btnNative').classList.toggle('hidden', !navigator.share);
  show('share');
  try { shareBlob = await canvasToBlob(cv); } catch { shareBlob = null; }
}

let toastTimer = 0;
function toast(msg) {
  if (!msg) return;
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- 입력 ----------
const canvas = $('game');
const stickEl = $('stick');
const knobEl = $('stickKnob');
const STICK_R = 70;

canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'play') return;
  e.preventDefault();
  sound.unlock();
  input.tap = true;
  if (stick.id == null) {
    stick.id = e.pointerId;
    stick.x0 = e.clientX;
    stick.y0 = e.clientY;
    stick.dx = stick.dy = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 등 캡처 불가 포인터 */ }
    if (run.phase === 'fly') {
      stickEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      stickEl.classList.remove('hidden');
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stick.id) return;
  let dx = e.clientX - stick.x0, dy = e.clientY - stick.y0;
  const l = Math.hypot(dx, dy);
  if (l > STICK_R) { dx *= STICK_R / l; dy *= STICK_R / l; }
  stick.dx = dx / STICK_R;
  stick.dy = dy / STICK_R;
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
});
function resetStick() {
  stick.id = null;
  stick.dx = stick.dy = 0;
  stickEl.classList.add('hidden');
  knobEl.style.transform = '';
}
canvas.addEventListener('pointerup', (e) => { if (e.pointerId === stick.id) resetStick(); });
canvas.addEventListener('pointercancel', (e) => { if (e.pointerId === stick.id) resetStick(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const KEYMAP = { ArrowUp: 'up', KeyW: 'up', Space: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (mode === 'play') pause();
    else if (mode === 'paused') resume();
    return;
  }
  if (mode === 'title' && (e.code === 'Enter' || e.code === 'Space') && !$('title').classList.contains('hidden')) {
    e.preventDefault();
    startPlay();
    return;
  }
  if (mode === 'result' && e.code === 'Enter' && !$('result').classList.contains('hidden')) {
    newRun();
    startPlay();
    return;
  }
  if (mode !== 'play') return;
  if (e.code === 'KeyM') { toggleMute(); return; }
  const k = KEYMAP[e.code];
  if (k || e.code === 'Enter') e.preventDefault();
  if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) input.tap = true;
  if (k) keys[k] = true;
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
});
window.addEventListener('blur', () => {
  keys.up = keys.down = keys.left = keys.right = false;
  resetStick();
  pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
  else sound.resume(); // iOS: 백그라운드에서 돌아오면 오디오가 멈춘 채 남아 있다
});

// ---------- WebGL 컨텍스트 손실 ----------
// 모바일에서 앱 전환·메모리 부족으로 GPU 컨텍스트가 사라질 수 있다. 복구되면 장면을 다시 만든다.
let glLost = false;
$('game').addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  glLost = true;
  pause();
  $('glLost').classList.remove('hidden');
});
$('game').addEventListener('webglcontextrestored', () => {
  glLost = false;
  renderer.setWorld(world);
  $('glLost').classList.add('hidden');
  if (mode === 'paused') show('pause');
});
$('btnGlReload').onclick = () => location.reload();

function readInput() {
  // 스틱: 위로 밀면 기수 ↑, 아래로 당기면 다이브, 좌우는 선회
  const kp = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
  const kr = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const dead = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
  input.pitch = Math.max(-1, Math.min(1, kp + dead(-stick.dy)));
  input.roll = Math.max(-1, Math.min(1, kr + dead(stick.dx)));
}

function toggleMute() {
  sound.unlock();
  sound.setMuted(!sound.muted);
  store.set('muted', sound.muted);
  $('btnMute').textContent = sound.muted ? '🔇' : '🔊';
}

// ---------- 버튼 ----------
$('btnStart').onclick = startPlay;
$('btnHow').onclick = () => show('how');
$('btnHowClose').onclick = () => show(mode === 'paused' ? 'pause' : 'title');
$('btnNewCity').onclick = () => newRun(randomSeed());
$('btnMute').onclick = toggleMute;
$('btnMute').textContent = sound.muted ? '🔇' : '🔊';
$('btnPause').onclick = pause;
$('btnResume').onclick = resume;
$('btnRestart').onclick = () => { newRun(); startPlay(); };
$('btnHome').onclick = goTitle;
$('btnRetry').onclick = () => { newRun(); startPlay(); };
$('btnNext').onclick = () => { newRun(randomSeed()); startPlay(); };
$('btnShare').onclick = openShare;
$('btnShareClose').onclick = () => show('result');
$('btnNative').onclick = async () => {
  const url = challengeUrl(lastResult.code, lastResult.score);
  const ok = await nativeShare(shareText(lastResult), url, shareBlob);
  if (!ok) toast('이 브라우저는 공유 시트를 지원하지 않아요. 링크 복사를 이용해 주세요.');
};
$('btnCopy').onclick = async () => {
  const url = challengeUrl(lastResult.code, lastResult.score);
  const ok = await copyText(`${shareText(lastResult)}\n${url}`);
  toast(ok ? '도전 링크를 복사했어요!' : '복사에 실패했어요. 주소창 링크를 직접 복사해 주세요.');
};
$('btnSave').onclick = async () => {
  try {
    const blob = shareBlob || (await canvasToBlob(await drawScoreCard(lastResult, snapshot)));
    downloadBlob(blob, `paper-skyline-${lastResult.code}-${lastResult.score}.png`);
  } catch {
    toast('이미지를 만들지 못했어요.');
  }
};

// ---------- HUD ----------
const hud = { score: $('hudScore'), combo: $('hudCombo'), dist: $('hudDist'), alt: $('hudAlt'), speed: $('hudSpeed'), paper: $('hudPaper'), hint: $('hint'), meter: $('meter'), fill: $('meterFill') };
let lastPaper = -1;
const isTouch = matchMedia('(pointer: coarse)').matches;

function updateHud() {
  const sp = speedOf(run.p);
  hud.score.textContent = totalScore(run).toLocaleString('ko-KR');
  hud.dist.textContent = `${distanceOf(run).toLocaleString('ko-KR')}m`;
  hud.alt.textContent = `${Math.max(0, Math.round(run.p.y))}m`;
  hud.speed.textContent = `${Math.round(sp * 3.6)}km/h`;
  if (run.combo > 0 && run.comboT > 0) {
    hud.combo.innerHTML = `콤보 ${run.combo} · ×${comboMult(run.combo).toFixed(2).replace(/\.?0+$/, '')}<span class="bar"><i style="width:${(run.comboT / 4) * 100}%"></i></span>`;
  } else hud.combo.textContent = '';
  if (lastPaper !== run.durability) {
    lastPaper = run.durability;
    hud.paper.innerHTML = [0, 1, 2].map((i) => `<i class="${i < run.durability ? '' : 'off'}"></i>`).join('');
  }
  let hint = '';
  if (run.phase === 'aim') hint = isTouch ? '탭해서 던질 각도를 정하세요' : '클릭 / Space 로 던질 각도를 정하세요';
  else if (run.phase === 'power') hint = '한 번 더 탭해서 던지기!';
  else if (run.phase === 'fly' && run.phaseT < 6) hint = isTouch ? '드래그: 위 기수↑ · 아래 다이브 · 좌우 선회' : '↑↓ 기수 · ←→ 선회 (마우스 드래그도 OK)';
  else if (run.phase === 'fly' && sp < 9 && !run.touching) hint = '실속! 기수를 내려 속도를 모으세요';
  if (hud.hint.textContent !== hint) hud.hint.textContent = hint;
  hud.meter.classList.toggle('hidden', run.phase !== 'power');
  if (run.phase === 'power') hud.fill.style.width = `${run.power * 100}%`;
}

// ---------- 루프 ----------
function frame(now) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  time += dt;
  if (mode === 'play') {
    acc += dt;
    readInput();
    while (acc >= DT) {
      step(run, input, DT, emit);
      input.tap = false;
      acc -= DT;
    }
    updateFx(dt);
    updateHud();
    sound.setWind(speedOf(run.p), run.phase === 'fly');
  } else {
    acc = 0;
  }
  if (mode !== 'paused' && !glLost) {
    renderer.draw({ run, fx, time, dt });
    updatePopups(dt);
    watchFps(dt);
  }
  requestAnimationFrame(frame);
}

// 비행 중 4초 평균 프레임이 40fps 미만이면 품질을 한 단계 낮춘다 (한 번만, 기기에 저장)
const fpsWin = { t: 0, n: 0 };
function watchFps(dt) {
  if (mode !== 'play' || run.phase !== 'fly' || renderer.quality === 'low') {
    fpsWin.t = fpsWin.n = 0;
    return;
  }
  fpsWin.t += dt;
  fpsWin.n++;
  if (fpsWin.t < 4) return;
  const fps = fpsWin.n / fpsWin.t;
  fpsWin.t = fpsWin.n = 0;
  if (fps < 40) {
    renderer.setQuality('low');
    store.set('quality', 'low');
    toast('부드러운 플레이를 위해 그래픽 품질을 낮췄어요');
  }
}

window.addEventListener('resize', () => renderer.resize());
renderer.resize();
renderer.setWorld(world);
newRun();
show('title');
$('btnStart').disabled = false;
$('btnStart').textContent = '비행 시작';
requestAnimationFrame(frame);

// 디버그·자동 검증용 훅: 로컬 개발 서버나 ?debug 에서만 노출
if (DEBUG) window.__paperSkyline = {
  get run() { return run; },
  get mode() { return mode; },
  renderer,
  input,
  // 백그라운드 탭처럼 requestAnimationFrame이 멈춘 환경에서 수동으로 진행시키는 검증용 함수
  advance(seconds, ctrl = {}) {
    debugTouched = true;
    const frames = Math.round(seconds * 60);
    for (let f = 0; f < frames; f++) {
      Object.assign(input, ctrl);
      for (let i = 0; i < 2; i++) { step(run, input, DT, emit); input.tap = false; }
      updateFx(1 / 60);
      time += 1 / 60;
      renderer.updateCamera(run, 1 / 60);
    }
    updateHud();
    renderer.draw({ run, fx, time, dt: 0 });
    updatePopups(0);
    return { phase: run.phase, x: run.p.x, y: run.p.y, z: run.p.z, score: totalScore(run) };
  },
};
