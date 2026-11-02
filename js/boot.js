// 게임 모듈을 불러오다 실패하면(네트워크 끊김·차단 등) 빈 화면 대신 안내와 재시도 버튼을 보여 준다
const fail = document.getElementById('loadfail');
const startBtn = document.getElementById('btnStart');

import('./main.js').catch((err) => {
  console.error('게임 모듈 로드 실패', err);
  startBtn.disabled = true;
  startBtn.textContent = '불러오기 실패';
  document.getElementById('loadfailDetail').textContent = String(err && err.message ? err.message : err);
  fail.classList.remove('hidden');
});

document.getElementById('btnReload').addEventListener('click', () => location.reload());
