// Three.js 3D 렌더러: 인스턴싱 빌딩(창문은 셰이더로) + 도로 + 하늘 + 추격 카메라
import * as THREE from 'three';
import { PALETTES, START_H, CELL, CITY_END, STYLE, surfaceAt } from './world.js';
import { attitude, speedOf } from './sim.js';
import { mulberry32 } from './rng.js';

const col = (hex) => new THREE.Color(hex);

// ---------- 공용 셰이더 조각 ----------
// 인스턴스마다 aStyle(외벽 스타일 번호)·aSeed(0~1 난수)를 받아 창문 무늬를 다르게 그린다
const WPOS_VERT_DECL = 'varying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying float vRoof;\nvarying vec3 vBase;\nvarying float vStyle;\nvarying float vSeed;\n';
const WPOS_VERT_BODY = `
  vec4 sbWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    sbWp = instanceMatrix * sbWp;
    vRoof = (instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y;
    vBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vWNrm = normalize(mat3(instanceMatrix) * objectNormal);
  #else
    vRoof = 1.0;
    vBase = vec3(0.0);
    vWNrm = objectNormal;
  #endif
  vStyle = aStyle;
  vSeed = aSeed;
  vWPos = (modelMatrix * sbWp).xyz;
`;

// 스타일 번호는 world.js 의 STYLE 과 같다: 0 격자 · 1 가로띠 · 2 세로핀 · 3 유리 · 4 벽돌 · 5 무창 · 6 광고판
const FACADE_FRAG = `
  {
    float side = 1.0 - step(0.5, abs(vWNrm.y));
    float u = abs(vWNrm.x) > 0.5 ? vWPos.z : vWPos.x;
    float fy = vWPos.y;
    float bot = vBase.y;
    float startY = bot < 0.5 ? 3.0 : bot + 1.2;
    float inBand = side * step(startY, fy) * step(fy, vRoof - 1.4);
    float st = floor(vStyle + 0.5);
    float floorH = 3.5 + vSeed * 0.9;
    vec2 cell = vec2(0.0);
    vec2 fc = vec2(0.0);
    float win = 0.0;
    if (st < 0.5) {
      cell = vec2(u / (2.8 + vSeed * 1.4), fy / floorH); fc = fract(cell);
      win = step(0.2, fc.x) * step(fc.x, 0.78) * step(0.24, fc.y) * step(fc.y, 0.8);
    } else if (st < 1.5) {
      cell = vec2(u / 2.6, fy / floorH); fc = fract(cell);
      win = step(0.05, fc.x) * step(0.3 + vSeed * 0.1, fc.y) * step(fc.y, 0.8);
    } else if (st < 2.5) {
      cell = vec2(u / (1.8 + vSeed * 0.8), fy / floorH); fc = fract(cell);
      win = step(0.4, fc.x) * step(0.05, fc.y) * step(fc.y, 0.95);
      diffuseColor.rgb *= 1.0 + 0.3 * inBand * (1.0 - step(0.4, fc.x));
    } else if (st < 3.5) {
      cell = vec2(u / 2.4, fy / floorH); fc = fract(cell);
      win = step(0.05, fc.x) * step(0.06, fc.y);
    } else if (st < 4.5) {
      cell = vec2(u / 3.0, fy / 3.3); fc = fract(cell);
      win = step(0.32, fc.x) * step(fc.x, 0.68) * step(0.28, fc.y) * step(fc.y, 0.74);
    }
    win *= inBand;
    vec2 wid = floor(cell) + floor(vBase.xz * 0.37) + vSeed * 17.0;
    float hsh = fract(sin(dot(wid, vec2(12.9898, 78.233))) * 43758.5453);
    float isGlass = step(2.5, st) * step(st, 3.5);
    float lit = step(hsh, uLit * (1.0 - isGlass * 0.55));
    // 불 켜진 창은 따뜻한 색/차가운 색이 섞여 있다
    vec3 winCol = uWin * mix(vec3(1.0), vec3(0.78, 0.92, 1.25), step(0.72, fract(hsh * 7.0)));
    if (isGlass > 0.5) {
      float refl = 0.35 + 0.45 * smoothstep(0.0, 1.0, (fy - bot) / max(1.0, vRoof - bot));
      diffuseColor.rgb = mix(diffuseColor.rgb, uGlassSky, win * refl * 0.55);
      totalEmissiveRadiance += winCol * win * lit * 0.55;
    } else {
      diffuseColor.rgb = mix(diffuseColor.rgb, uWinOff, win * (1.0 - lit) * 0.8);
      totalEmissiveRadiance += winCol * win * lit * (0.65 + 0.35 * hsh);
    }
    if (st > 3.5 && st < 4.5) {
      // 벽돌 건물: 옥상 코니스 + 층 띠
      float cor = side * step(vRoof - 1.2, fy);
      float band = side * step(0.94, fract(fy / 3.3)) * step(startY, fy);
      diffuseColor.rgb *= 1.0 + 0.4 * cor + 0.15 * band;
    }
    if (st > 5.5) {
      // 광고판: 앞뒤 면 패널이 스스로 빛난다
      float face = step(0.5, abs(vWNrm.z));
      float panel = face * step(bot + 2.0, fy) * step(fy, vRoof - 0.4);
      float scan = 0.85 + 0.15 * step(0.5, fract(fy * 1.5));
      totalEmissiveRadiance += diffuseColor.rgb * panel * scan * 1.1;
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.25, diffuseColor.rgb, panel);
    }
    float roof = step(0.5, vWNrm.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + 0.04, roof);
    float edge = side * smoothstep(vRoof - 0.7, vRoof - 0.15, fy) * step(st, 4.5);
    totalEmissiveRadiance += uEdge * edge * 0.3;
  }
`;

function buildingMaterial(pal) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = {
    uWin: { value: col(pal.win) },
    uWinOff: { value: col(pal.winOff) },
    uEdge: { value: col(pal.edge) },
    uGlassSky: { value: col(pal.glassSky) },
    uLit: { value: pal.litRate },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStyle;\nattribute float aSeed;\n' + WPOS_VERT_DECL)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + WPOS_VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WPOS_VERT_DECL + 'uniform vec3 uWin;\nuniform vec3 uWinOff;\nuniform vec3 uEdge;\nuniform vec3 uGlassSky;\nuniform float uLit;\n')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FACADE_FRAG);
  };
  return mat;
}

function groundMaterial(pal) {
  const mat = new THREE.MeshLambertMaterial({ color: col(pal.ground) });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStreet = { value: col(pal.street) };
    shader.uniforms.uLine = { value: col(pal.line) };
    shader.uniforms.uCell = { value: CELL };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;\nuniform vec3 uStreet;\nuniform vec3 uLine;\nuniform float uCell;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float tx = fract(vGPos.x / uCell + 0.5);
        float tz = fract(vGPos.z / uCell + 0.5);
        float dx = min(tx, 1.0 - tx) * uCell;
        float dz = min(tz, 1.0 - tz) * uCell;
        float road = max(step(dx, 6.0), step(dz, 6.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, uStreet, road);
        float dashZ = step(0.5, fract(vGPos.z / 6.0));
        float dashX = step(0.5, fract(vGPos.x / 6.0));
        float lineX = step(dx, 0.18) * dashZ * (1.0 - step(dz, 6.0));
        float lineZ = step(dz, 0.18) * dashX * (1.0 - step(dx, 6.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, uLine, max(lineX, lineZ) * 0.8);
      }`);
  };
  return mat;
}

function skyMaterial(pal) {
  const stops = pal.sky.map((c) => col(c));
  while (stops.length < 5) stops.push(stops[stops.length - 1]);
  const sd = new THREE.Vector3(...pal.sunDir).normalize();
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      c0: { value: stops[0] }, c1: { value: stops[1] }, c2: { value: stops[2] }, c3: { value: stops[3] }, c4: { value: stops[4] },
      n: { value: pal.sky.length },
      sunDir: { value: sd },
      sunCol: { value: col(pal.sun) },
      starAmt: { value: pal.stars },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 c0, c1, c2, c3, c4; uniform float n; uniform vec3 sunDir; uniform vec3 sunCol; uniform float starAmt;
      varying vec3 vDir;
      vec3 grad(float t){
        float s = t * (n - 1.0);
        if (s < 1.0) return mix(c0, c1, s);
        if (s < 2.0) return mix(c1, c2, s - 1.0);
        if (s < 3.0) return mix(c2, c3, s - 2.0);
        return mix(c3, c4, clamp(s - 3.0, 0.0, 1.0));
      }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        float t = 1.0 - clamp(pow(max(h, 0.0), 0.55), 0.0, 1.0);
        vec3 c = grad(t);
        float sd = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(sd, 900.0) * 1.6 + pow(sd, 12.0) * 0.35);
        if (starAmt > 0.0 && h > 0.05) {
          vec3 q = floor(d * 280.0);
          float s = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          c += vec3(step(0.9975, s) * starAmt * smoothstep(0.05, 0.3, h));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function softTexture(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stripeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 256;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 64, 256);
  for (let i = 0; i < 18; i++) {
    const x = (i * 37) % 64, y = (i * 71) % 256;
    const gr = g.createLinearGradient(0, y, 0, y + 40);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x, y, 2, 40);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function helipadTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 14;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,214,102,0.95)';
  g.font = '900 150px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', 128, 136);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function paperPlaneGeometry() {
  // 앞 = +Z, 위 = +Y. 넓은 두 날개 + 아래로 접힌 용골
  const nose = [0, 0, 1.5];
  const lt = [-1.0, 0.12, -1.0];
  const rt = [1.0, 0.12, -1.0];
  const tail = [0, 0, -1.0];
  const keel = [0, -0.38, -0.95];
  const pos = [
    ...nose, ...lt, ...tail,
    ...nose, ...tail, ...rt,
    ...nose, ...tail, ...keel,
    ...nose, ...keel, ...tail,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.75 : 1.8;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: false });
  g.translate(0, 0, -0.25);
  return g;
}

const PLANE_SCALE = 1.8; // 화면에서 잘 보이도록 실제 충돌 크기보다 크게 그린다
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, 1, 0.3, 6000);
    this.W = 1;
    this.H = 1;
    this.group = null;
    this.disposables = [];
    this.cam = { pos: new THREE.Vector3(0, START_H + 4, -12), look: new THREE.Vector3(0, START_H, 20), heading: new THREE.Vector3(0, 0, 1), shake: 0, roll: 0 };
    this.softTex = softTexture();
    this.stripeTex = stripeTexture();
    this.helipadTex = helipadTexture();

    // 비행기·궤적·파티클은 도시와 무관하게 한 번만 만든다
    this.plane = new THREE.Mesh(paperPlaneGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, flatShading: true, emissive: 0x4a4a5c }));
    this.plane.scale.setScalar(PLANE_SCALE);
    const ball = new THREE.IcosahedronGeometry(0.9, 1);
    const pa = ball.attributes.position;
    const rj = mulberry32(7);
    for (let i = 0; i < pa.count; i++) {
      _v.fromBufferAttribute(pa, i).multiplyScalar(0.75 + rj() * 0.5);
      pa.setXYZ(i, _v.x, _v.y, _v.z);
    }
    ball.computeVertexNormals();
    this.ball = new THREE.Mesh(ball, new THREE.MeshLambertMaterial({ color: 0xf2efe6, flatShading: true }));
    this.ball.visible = false;
    this.scene.add(this.plane, this.ball);

    const TRAIL = 90;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 4), 4));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.trailMax = TRAIL;
    this.scene.add(this.trail);

    const PMAX = 400;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PMAX * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PMAX * 3), 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.7, vertexColors: true, map: this.softTex, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false;
    this.pMax = PMAX;
    this.scene.add(this.points);

    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    this.aimDots = new THREE.Points(ag, new THREE.PointsMaterial({ size: 1.1, color: 0xffffff, map: this.softTex, transparent: true, depthWrite: false }));
    this.aimDots.frustumCulled = false;
    this.scene.add(this.aimDots);
  }

  resize() {
    const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
    this.W = W;
    this.H = H;
    this.renderer.setSize(W, H, false);
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  track(o) {
    this.disposables.push(o);
    return o;
  }

  setWorld(world) {
    if (this.group) {
      this.scene.remove(this.group);
      for (const d of this.disposables) d.dispose();
      this.disposables = [];
    }
    const pal = PALETTES[world.palette];
    this.pal = pal;
    this.world = world;
    const group = new THREE.Group();
    this.group = group;
    this.scene.fog = new THREE.Fog(col(pal.fog), 180, 1700);

    // 조명
    const sun = new THREE.DirectionalLight(col(pal.sun), 1.6 * pal.light);
    sun.position.set(...pal.sunDir).multiplyScalar(100);
    const hemi = new THREE.HemisphereLight(col(pal.sky[pal.sky.length - 2]), col(pal.ground), 1.1 + (1 - pal.light) * 0.6);
    group.add(sun, hemi);

    // 하늘
    this.sky = new THREE.Mesh(this.track(new THREE.SphereGeometry(4500, 32, 16)), this.track(skyMaterial(pal)));
    this.sky.renderOrder = -1;
    group.add(this.sky);

    // 지면
    const ground = new THREE.Mesh(this.track(new THREE.PlaneGeometry(16000, 16000)), this.track(groundMaterial(pal)));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 3000);
    group.add(ground);

    // 빌딩 덩어리: 게임 빌딩의 몸체·계단·포디움·펜트하우스·광고판 + 바깥쪽 배경 숲
    const rnd = mulberry32(world.seed ^ 0x9e3779b9);
    const blocks = []; // { x0,x1,z0,z1,bot,top, style, color, seed }
    const tone = (hex, j = 0.05) => col(hex).offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * j);
    const spires = [];
    const tanks = [];
    for (const b of world.buildings) {
      const base = col(pal.mats[b.style][b.tint]);
      for (const p of b.parts) {
        if (p.kind === 'spire') { spires.push(p); continue; }
        if (p.kind === 'tank') { tanks.push(p); continue; }
        let style = b.style;
        let color = base.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.05);
        if (p.kind === 'podium') { style = STYLE.RIBBON; color = tone(pal.mats[STYLE.RIBBON][b.tint]); }
        else if (p.kind === 'cap') { style = STYLE.PLAIN; color = tone(pal.mats[STYLE.PLAIN][b.tint]); }
        else if (p.kind === 'board') { style = STYLE.BOARD; color = col(pal.boards[b.board]); }
        blocks.push({ ...p, style, color, seed: b.seed });
      }
    }
    for (let i = 0; i < 1560; i++) {
      let x, z, h;
      if (i < 1400) {
        const side = rnd() < 0.5 ? -1 : 1;
        x = side * (330 + rnd() * 1300);
        z = -400 + rnd() * (CITY_END + 1200);
        h = 40 + rnd() ** 1.5 * 260 * Math.max(0.35, 1 - z / (CITY_END * 1.4));
      } else {
        // 시작 타워 뒤쪽
        x = (rnd() - 0.5) * 900;
        z = -120 - rnd() * 700;
        h = 60 + rnd() * 200;
      }
      const w = 20 + rnd() * 40, d = 20 + rnd() * 40;
      const style = Math.floor(rnd() * 5);
      blocks.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, bot: 0, top: h, style, color: tone(pal.mats[style][Math.floor(rnd() * 4)]), seed: rnd() });
    }
    const box = this.track(new THREE.BoxGeometry(1, 1, 1));
    box.translate(0, 0.5, 0);
    const bbox = this.track(box.clone());
    const aStyle = new Float32Array(blocks.length);
    const aSeed = new Float32Array(blocks.length);
    const inst = new THREE.InstancedMesh(bbox, this.track(buildingMaterial(pal)), blocks.length);
    blocks.forEach((p, i) => {
      _v.set((p.x0 + p.x1) / 2, p.bot, (p.z0 + p.z1) / 2);
      _s.set(p.x1 - p.x0, p.top - p.bot, p.z1 - p.z0);
      inst.setMatrixAt(i, _m.compose(_v, _q.identity(), _s));
      inst.setColorAt(i, p.color);
      aStyle[i] = p.style;
      aSeed[i] = p.seed;
    });
    bbox.setAttribute('aStyle', new THREE.InstancedBufferAttribute(aStyle, 1));
    bbox.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
    group.add(inst);

    // 같은 지오메트리를 여러 위치에 찍는 도우미
    const stamp = (geo, mat, list, place, color) => {
      if (!list.length) return null;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        _q.identity();
        place(it, _v, _s);
        m.setMatrixAt(i, _m.compose(_v, _q, _s));
        if (color) m.setColorAt(i, color(it));
      });
      group.add(m);
      return m;
    };
    const metal = col(pal.mats[STYLE.PLAIN][0]).offsetHSL(0, -0.05, 0.12);

    // 첨탑 + 경고등
    this.beaconMat = null;
    if (spires.length) {
      stamp(box, this.track(new THREE.MeshLambertMaterial({ color: metal })), spires, (p, v, sc) => {
        v.set((p.x0 + p.x1) / 2, p.bot, (p.z0 + p.z1) / 2);
        sc.set(p.x1 - p.x0, p.top - p.bot, p.z1 - p.z0);
      });
      this.beaconMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff4757, transparent: true }));
      stamp(this.track(new THREE.SphereGeometry(0.7, 8, 6)), this.beaconMat, spires, (p, v, sc) => {
        v.set((p.x0 + p.x1) / 2, p.top + 0.4, (p.z0 + p.z1) / 2);
        sc.set(1, 1, 1);
      });
    }

    // 물탱크: 원통 + 고깔 지붕 + 받침
    const tankCol = col(pal.stars > 0.5 ? '#3a2f2a' : '#8a6a4a');
    const tankGeo = this.track(new THREE.CylinderGeometry(1.7, 1.7, 1, 14));
    tankGeo.translate(0, 0.5, 0);
    stamp(tankGeo, this.track(new THREE.MeshLambertMaterial({ color: tankCol })), tanks, (p, v, sc) => {
      v.set((p.x0 + p.x1) / 2, p.bot + 1.3, (p.z0 + p.z1) / 2);
      sc.set(1, p.top - p.bot - 2.2, 1);
    });
    const coneGeo = this.track(new THREE.ConeGeometry(1.9, 1.1, 14));
    coneGeo.translate(0, 0.55, 0);
    stamp(coneGeo, this.track(new THREE.MeshLambertMaterial({ color: tankCol.clone().multiplyScalar(0.75) })), tanks, (p, v, sc) => {
      v.set((p.x0 + p.x1) / 2, p.top - 0.9, (p.z0 + p.z1) / 2);
      sc.set(1, 1, 1);
    });
    stamp(box, this.track(new THREE.MeshLambertMaterial({ color: metal.clone().multiplyScalar(0.6) })), tanks, (p, v, sc) => {
      v.set((p.x0 + p.x1) / 2, p.bot, (p.z0 + p.z1) / 2);
      sc.set(2.6, 1.3, 2.6);
    });

    // 옥상 장식: 실외기 · 헬리패드 · 옥상 정원 · 나무
    const decor = { ac: [], helipad: [], garden: [], tree: [] };
    for (const b of world.buildings) for (const d of b.decor) decor[d.type].push(d);
    const trees = decor.tree.concat(world.trees);
    stamp(box, this.track(new THREE.MeshLambertMaterial({ color: metal })), decor.ac, (d, v, sc) => {
      v.set(d.x, d.y, d.z);
      sc.set(1.8, 1.1, 1.3);
    });
    const flat = this.track(new THREE.PlaneGeometry(1, 1));
    flat.rotateX(-Math.PI / 2);
    stamp(flat, this.track(new THREE.MeshLambertMaterial({ map: this.helipadTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })), decor.helipad, (d, v, sc) => {
      v.set(d.x, d.y + 0.06, d.z);
      sc.set(d.w, 1, d.w);
    });
    const leaf = col(pal.leaf);
    stamp(flat, this.track(new THREE.MeshLambertMaterial({ color: leaf.clone().multiplyScalar(0.85), polygonOffset: true, polygonOffsetFactor: -2 })), decor.garden, (d, v, sc) => {
      v.set(d.x, d.y + 0.06, d.z);
      sc.set(d.w, 1, d.d);
    });
    // 지상 공원·광장
    stamp(flat, this.track(new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1 })), world.parks, (pk, v, sc) => {
      v.set((pk.x0 + pk.x1) / 2, 0.05, (pk.z0 + pk.z1) / 2);
      sc.set(pk.x1 - pk.x0, 1, pk.z1 - pk.z0);
    }, (pk) => col(pk.kind === 'park' ? pal.park : pal.plaza));
    const trunkGeo = this.track(new THREE.CylinderGeometry(0.12, 0.16, 1, 5));
    trunkGeo.translate(0, 0.5, 0);
    stamp(trunkGeo, this.track(new THREE.MeshLambertMaterial({ color: pal.stars > 0.5 ? 0x2a1d16 : 0x6b4a32 })), trees, (t, v, sc) => {
      v.set(t.x, t.y, t.z);
      sc.set(t.s, t.s * 1.1, t.s);
    });
    const crownGeo = this.track(new THREE.IcosahedronGeometry(0.75, 0));
    stamp(crownGeo, this.track(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })), trees, (t, v, sc) => {
      v.set(t.x, t.y + t.s * 1.45, t.z);
      sc.set(t.s, t.s * 1.15, t.s);
    }, () => leaf.clone().offsetHSL((rnd() - 0.5) * 0.06, 0, (rnd() - 0.5) * 0.12));

    // 상승기류 기둥
    if (world.vents.length) {
      const cyl = this.track(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true));
      cyl.translate(0, 0.5, 0);
      this.stripeTex.repeat.set(3, 1);
      this.ventMat = this.track(new THREE.MeshBasicMaterial({ color: 0xa8ecff, map: this.stripeTex, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const vm = new THREE.InstancedMesh(cyl, this.ventMat, world.vents.length);
      const vb = new THREE.InstancedMesh(box, this.track(new THREE.MeshLambertMaterial({ color: 0xb8c2d6 })), world.vents.length);
      world.vents.forEach((v, i) => {
        vm.setMatrixAt(i, _m.compose(_v.set(v.x, v.top, v.z), _q.identity(), _s.set(v.sigma * 0.9, v.height, v.sigma * 0.9)));
        vb.setMatrixAt(i, _m.compose(_v.set(v.x, v.top, v.z), _q.identity(), _s.set(5, 1.8, 5)));
      });
      group.add(vm, vb);
    } else this.ventMat = null;

    // 종이별
    this.starMesh = null;
    if (world.stars.length) {
      const sg = this.track(starGeometry());
      const smat = this.track(new THREE.MeshLambertMaterial({ color: 0xffe27a, emissive: 0xc98a1a }));
      this.starMesh = new THREE.InstancedMesh(sg, smat, world.stars.length);
      this.starMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(this.starMesh);
    }

    // 구름
    const cmat = this.track(new THREE.SpriteMaterial({ map: this.softTex, color: col(pal.cloud), transparent: true, opacity: pal.stars > 0.5 ? 0.35 : 0.75, depthWrite: false }));
    for (let i = 0; i < 70; i++) {
      const sp = new THREE.Sprite(cmat);
      sp.position.set((rnd() - 0.5) * 3000, 380 + rnd() * 320, -500 + rnd() * (CITY_END + 1500));
      sp.scale.set(160 + rnd() * 220, 50 + rnd() * 50, 1);
      group.add(sp);
    }

    this.scene.add(group);
  }

  resetCamera(run) {
    const p = run.p;
    this.cam.heading.set(0, 0, 1);
    this.cam.pos.set(p.x + 3, p.y + 4.5, p.z - 9);
    this.cam.look.set(p.x, p.y - 45, p.z + 110);
    this.cam.shake = 0;
    this.cam.roll = 0;
  }

  // 화면 좌표(px) 투영. 카메라 뒤면 null
  project(x, y, z) {
    _v.set(x, y, z).project(this.camera);
    if (_v.z > 1) return null;
    return { x: (_v.x + 1) / 2 * this.W, y: (1 - _v.y) / 2 * this.H };
  }

  updateCamera(run, dt) {
    const p = run.p;
    const cam = this.cam;
    const sp = speedOf(p);
    const flying = run.phase === 'fly' || run.phase === 'landed' || run.phase === 'done';
    const hs = Math.hypot(p.vx, p.vz);
    if (flying && hs > 2) {
      _v.set(p.vx / hs, 0, p.vz / hs);
      cam.heading.lerp(_v, 1 - Math.exp(-dt * 2.2)).normalize();
    }
    const h = cam.heading;
    let tp, tl;
    if (!flying) {
      // 던지기 전: 비행기 뒤 어깨 너머로 도시를 내려다본다
      tp = new THREE.Vector3(p.x + 3, p.y + 4.5, p.z - 9);
      tl = new THREE.Vector3(p.x, p.y - 45 + run.aim * 60, p.z + 110);
    } else {
      const dist = 7.5 + sp * 0.08;
      const up = 2.2 + sp * 0.02;
      tp = new THREE.Vector3(p.x - h.x * dist, p.y + up - p.vy * 0.08, p.z - h.z * dist);
      tl = new THREE.Vector3(p.x + h.x * 14, p.y + 0.8 + p.vy * 0.25, p.z + h.z * 14);
    }
    // 카메라가 빌딩 속으로 들어가지 않게: 비행기 → 목표 위치로 조금씩 나아가며 막히기 직전에 멈춘다
    if (flying) {
      const sx = p.x, sy = p.y + 0.5, sz = p.z;
      let fx = sx, fy = sy, fz = sz;
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const x = sx + (tp.x - sx) * t, y = sy + (tp.y - sy) * t, z = sz + (tp.z - sz) * t;
        if (y < surfaceAt(this.world, x, z) + 1.2) break;
        fx = x; fy = y; fz = z;
      }
      tp.set(fx, fy, fz);
    }
    const floor = surfaceAt(this.world, tp.x, tp.z) + 1.2;
    if (tp.y < floor) tp.y = floor;
    const k = 1 - Math.exp(-dt * (flying ? 5 : 8));
    cam.pos.lerp(tp, k);
    if (flying && cam.pos.y < surfaceAt(this.world, cam.pos.x, cam.pos.z) + 1) cam.pos.copy(tp);
    cam.look.lerp(tl, k);
    cam.roll += ((flying && run.phase === 'fly' ? p.bank * 0.35 : 0) - cam.roll) * (1 - Math.exp(-dt * 4));
    cam.shake = Math.max(0, cam.shake - dt * 2.5);

    const c = this.camera;
    c.position.copy(cam.pos);
    if (cam.shake > 0) c.position.add(_v.set((Math.random() - 0.5) * cam.shake, (Math.random() - 0.5) * cam.shake, (Math.random() - 0.5) * cam.shake));
    c.lookAt(cam.look);
    c.rotateZ(-cam.roll);
    const fov = 62 + Math.min(18, Math.max(0, sp - 15) * 0.45);
    if (Math.abs(c.fov - fov) > 0.05) {
      c.fov += (fov - c.fov) * Math.min(1, dt * 3);
      c.updateProjectionMatrix();
    }
  }

  draw({ run, fx, time, dt }) {
    if (!this.group) return;
    this.updateCamera(run, dt);
    const p = run.p;

    this.sky.position.copy(this.camera.position);
    if (this.beaconMat) this.beaconMat.opacity = 0.35 + 0.65 * ((Math.sin(time * 4) + 1) / 2);
    if (this.ventMat) this.stripeTex.offset.y = -time * 0.35;

    // 비행기 자세
    let nose, up;
    if (run.phase === 'aim' || run.phase === 'power') {
      nose = [0, Math.sin(run.aim), Math.cos(run.aim)];
      up = [0, Math.cos(run.aim), -Math.sin(run.aim)];
    } else ({ nose, up } = attitude(p));
    if (run.crumpled) {
      this.plane.visible = false;
      this.ball.visible = true;
      this.ball.position.set(p.x, p.y, p.z);
      this.ball.rotation.set(time * 5, time * 3.3, 0);
    } else {
      this.plane.visible = true;
      this.ball.visible = false;
      const z = _v.set(nose[0], nose[1], nose[2]);
      const y = new THREE.Vector3(up[0], up[1], up[2]);
      const x = new THREE.Vector3().crossVectors(y, z).normalize();
      _m.makeBasis(x, y, z);
      this.plane.quaternion.setFromRotationMatrix(_m);
      this.plane.position.set(p.x, p.y, p.z);
      // 내구도가 줄면 살짝 구겨져 보이게
      this.plane.scale.set(PLANE_SCALE, PLANE_SCALE * (run.durability < 3 ? 0.8 : 1), PLANE_SCALE * (run.durability < 2 ? 0.88 : 1));
    }

    // 종이별 회전
    if (this.starMesh) {
      const stars = this.world.stars;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const taken = run.taken.has(s.id);
        _e.set(0, time * 1.6 + i, 0);
        _q.setFromEuler(_e);
        _s.setScalar(taken ? 0.0001 : 1);
        this.starMesh.setMatrixAt(i, _m.compose(_v.set(s.x, s.y + Math.sin(time * 2 + i) * 0.5, s.z), _q, _s));
      }
      this.starMesh.instanceMatrix.needsUpdate = true;
    }

    // 궤적
    const tp = this.trail.geometry.attributes.position.array;
    const tc = this.trail.geometry.attributes.color.array;
    const n = Math.min(fx.trail.length, this.trailMax);
    for (let i = 0; i < this.trailMax; i++) {
      const src = fx.trail[Math.max(0, fx.trail.length - n + Math.min(i, n - 1))];
      const q = src || p;
      tp[i * 3] = q.x;
      tp[i * 3 + 1] = q.y;
      tp[i * 3 + 2] = q.z;
      tc[i * 4] = tc[i * 4 + 1] = tc[i * 4 + 2] = 1;
      tc[i * 4 + 3] = i < n ? (i / n) * 0.6 : 0;
    }
    this.trail.geometry.setDrawRange(0, n);
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;

    // 파티클
    const pp = this.points.geometry.attributes.position.array;
    const pc = this.points.geometry.attributes.color.array;
    const m = Math.min(fx.particles.length, this.pMax);
    for (let i = 0; i < m; i++) {
      const q = fx.particles[i];
      pp[i * 3] = q.x;
      pp[i * 3 + 1] = q.y;
      pp[i * 3 + 2] = q.z;
      const a = Math.max(0, q.life / q.max);
      pc[i * 3] = q.color[0] * a;
      pc[i * 3 + 1] = q.color[1] * a;
      pc[i * 3 + 2] = q.color[2] * a;
    }
    this.points.geometry.setDrawRange(0, m);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    // 조준 미리보기
    const aiming = run.phase === 'aim' || run.phase === 'power';
    this.aimDots.visible = aiming;
    if (aiming) {
      const ap = this.aimDots.geometry.attributes.position.array;
      const spd = 12 + 24 * (run.phase === 'power' ? run.power : 0.5);
      let x = p.x, y = p.y, z = p.z, vy = Math.sin(run.aim) * spd;
      const vz = Math.cos(run.aim) * spd;
      for (let i = 0; i < 16; i++) {
        vy -= 2.5 * 0.12;
        y += vy * 0.12;
        z += vz * 0.12;
        ap[i * 3] = x;
        ap[i * 3 + 1] = y;
        ap[i * 3 + 2] = z;
      }
      this.aimDots.geometry.attributes.position.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }

  // 공유 카드용 현재 화면 캡처 (render 직후 같은 태스크에서 호출해야 버퍼가 남아 있다)
  capture(state) {
    this.draw({ ...state, dt: 0 });
    try {
      return this.canvas.toDataURL('image/jpeg', 0.9);
    } catch {
      return null;
    }
  }
}
