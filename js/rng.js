// 시드 기반 난수: 같은 시드 = 같은 도시 (챌린지 링크 공유용)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 정수 좌표 → [0,1) 해시. 창문 점등처럼 매 프레임 같은 값이 필요한 곳에 쓴다.
export function hash2(a, b, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// 시드 ↔ 5자리 도시 코드 (32^5 ≈ 3,355만 개)
export function seedToCode(seed) {
  let n = seed >>> 0;
  let s = '';
  for (let i = 0; i < 5; i++) {
    s = ALPHABET[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
}

export function codeToSeed(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  if (!/^[2-9A-HJ-NP-Z]{5}$/.test(c)) return null;
  let n = 0;
  for (const ch of c) n = n * 32 + ALPHABET.indexOf(ch);
  return n;
}

// 챌린지 링크 확인 태그: 도시 코드 + 점수의 FNV-1a 해시를 4글자로.
// 비밀키가 없는 클라이언트 계산이라 위조를 '막지'는 못하고, 주소창 숫자만 바꾸는 변조를 걸러 낸다.
export function challengeTag(code, score) {
  let h = 0x811c9dc5;
  for (const ch of `${code}:${score}:paper-skyline`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return seedToCode(h % 32 ** 5).slice(1);
}

export function randomSeed() {
  return Math.floor(Math.random() * 32 ** 5);
}
