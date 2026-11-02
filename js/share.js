// 점수 카드 이미지 + 챌린지 링크 공유
import { PALETTES } from './world.js';
import { hash2, challengeTag } from './rng.js';

const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

export function challengeUrl(code, score) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('city', code);
  u.searchParams.set('c', String(score));
  u.searchParams.set('v', challengeTag(code, score));
  return u.toString();
}

export function shareText(r) {
  const fmt = (n) => n.toLocaleString('ko-KR');
  const extras = [];
  if (r.loops) extras.push(`루프 ${r.loops}회`);
  if (r.stars) extras.push(`종이별 ${r.stars}개`);
  if (r.landing === 'perfect') extras.push('완벽한 착지');
  return `✈️ PAPER SKYLINE 3D 도시 #${r.code}에서 ${fmt(r.score)}점! (${fmt(r.distance)}m 비행${extras.length ? ' · ' + extras.join(' · ') : ''})\n같은 도시에서 내 기록 깨 봐 👇`;
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// snapshot: 게임 종료 순간의 3D 화면(dataURL). 없으면 일러스트 스카이라인으로 대체
export async function drawScoreCard(r, snapshot) {
  const W = 1200, H = 630;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const pal = PALETTES[r.palette];
  const shot = await loadImage(snapshot);
  if (shot) {
    const k = Math.max(W / shot.width, H / shot.height);
    g.drawImage(shot, (W - shot.width * k) / 2, (H - shot.height * k) / 2, shot.width * k, shot.height * k);
    const shade = g.createLinearGradient(0, 0, W, 0);
    shade.addColorStop(0, 'rgba(8,10,30,0.78)');
    shade.addColorStop(0.62, 'rgba(8,10,30,0.25)');
    shade.addColorStop(1, 'rgba(8,10,30,0.05)');
    g.fillStyle = shade;
    g.fillRect(0, 0, W, H);
    drawCardText(g, r, pal, W, H);
    return cv;
  }

  const grad = g.createLinearGradient(0, 0, 0, H);
  pal.sky.forEach((c, i) => grad.addColorStop(i / (pal.sky.length - 1), c));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = pal.sun;
  g.globalAlpha = 0.9;
  g.beginPath();
  g.arc(W * 0.8, H * 0.3, 60, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;

  // 스카이라인 실루엣 2층
  for (const [layer, color, base] of [[0, pal.far, 470], [1, pal.mats[0][0], 540]]) {
    g.fillStyle = color;
    let x = -10;
    let i = 0;
    while (x < W) {
      const w = 40 + hash2(i, layer + 50) * 60;
      const h = (layer ? 60 : 120) + hash2(i, layer + 60) * (layer ? 160 : 220);
      g.fillRect(x, base - h, w, H);
      if (layer) {
        g.fillStyle = pal.win;
        g.globalAlpha = 0.7;
        for (let yy = base - h + 12; yy < H - 10; yy += 18) {
          for (let xx = x + 8; xx < x + w - 10; xx += 14) if (hash2(xx | 0, yy | 0, 3) < pal.litRate) g.fillRect(xx, yy, 6, 8);
        }
        g.globalAlpha = 1;
        g.fillStyle = color;
      }
      x += w + 6;
      i++;
    }
  }

  // 비행 궤적 + 종이비행기
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 5;
  g.setLineDash([2, 14]);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(70, 160);
  g.bezierCurveTo(300, 120, 520, 330, 860, 250);
  g.stroke();
  g.setLineDash([]);
  g.save();
  g.translate(900, 240);
  g.rotate(-0.25);
  const S = 46;
  g.fillStyle = '#fff';
  g.strokeStyle = 'rgba(30,30,60,0.6)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(S * 1.1, 0);
  g.lineTo(-S * 0.9, -S * 0.42);
  g.lineTo(-S * 0.62, 0);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#d9dcef';
  g.beginPath();
  g.moveTo(S * 1.1, 0);
  g.lineTo(-S * 0.62, 0);
  g.lineTo(-S * 0.8, S * 0.22);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();

  drawCardText(g, r, pal, W, H);
  return cv;
}

export const LANDING_LABEL = {
  perfect: '완벽',
  smooth: '부드러움',
  rough: '거침',
  roof: '옥상',
  wreck: '구겨짐',
};

function drawCardText(g, r, pal, W, H) {
  // 텍스트 패널
  g.fillStyle = 'rgba(8,10,30,0.55)';
  roundRect(g, 56, 300, 640, 290, 28);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = `900 46px ${FONT}`;
  g.fillText('PAPER SKYLINE', 70, 80);
  g.font = `600 24px ${FONT}`;
  g.globalAlpha = 0.85;
  g.fillText(`도시 #${r.code} · ${pal.name}`, 72, 118);
  g.globalAlpha = 1;

  g.font = `700 26px ${FONT}`;
  g.fillStyle = '#ffd98a';
  g.fillText(r.isBest ? '🏆 최고 기록' : 'SCORE', 90, 352);
  g.font = `900 104px ${FONT}`;
  g.fillStyle = '#ffffff';
  g.fillText(r.score.toLocaleString('ko-KR'), 84, 455);

  const stats = [
    ['비행 거리', `${r.distance.toLocaleString('ko-KR')}m`],
    ['액션', `${r.actions}개`],
    ['착지', LANDING_LABEL[r.landing] || '-'],
  ];
  g.font = `600 22px ${FONT}`;
  stats.forEach(([k, v], i) => {
    const x = 90 + i * 200;
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(k, x, 515);
    g.fillStyle = '#fff';
    g.font = `800 30px ${FONT}`;
    g.fillText(v, x, 554);
    g.font = `600 22px ${FONT}`;
  });

  g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = `700 24px ${FONT}`;
  g.fillText('같은 도시에서 도전하기 →', W - 60, H - 46);
  g.textAlign = 'left';
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function canvasToBlob(cv) {
  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 생성 실패'))), 'image/png'));
}

// Web Share API(이미지 포함) → 텍스트만 → 실패 시 false
export async function nativeShare(text, url, blob) {
  if (!navigator.share) return false;
  const file = blob ? new File([blob], 'paper-skyline.png', { type: 'image/png' }) : null;
  const data = { title: 'PAPER SKYLINE', text, url };
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ ...data, files: [file] });
    else await navigator.share(data);
    return true;
  } catch (e) {
    if (e && e.name === 'AbortError') return true; // 사용자가 공유 시트를 닫음
    return false;
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function xIntentUrl(text, url) {
  const u = new URL('https://x.com/intent/post');
  u.searchParams.set('text', text);
  u.searchParams.set('url', url);
  return u.toString();
}
