// Supabase 설정
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let selectedUser = null;
let rawMatchDetails = [];
let streakDataMap = new Map();

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();

  // 버튼 및 필터 이벤트 리스너 연결
  document.getElementById('btnSearch').addEventListener('click', applyFiltersAndRender);
  document.getElementById('searchOpponent').addEventListener('input', applyFiltersAndRender);
  document.getElementById('matchTypeSelect').addEventListener('change', applyFiltersAndRender);
  document.getElementById('sortSelect').addEventListener('change', applyFiltersAndRender);
  
  document.getElementById('btnReset').addEventListener('click', () => {
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';
    document.getElementById('searchOpponent').value = '';
    document.getElementById('matchTypeSelect').value = 'ALL';
    document.getElementById('sortSelect').value = 'RECENT';
    applyFiltersAndRender();
  });
});

// 1. 유저 목록 불러오기
async function loadUsers() {
  const { data: users, error } = await supabaseClient.from('users').select('*');
  if (error || !users) return;

  const bar = document.getElementById('nicknameBar');
  bar.innerHTML = '';

  users.forEach((user, idx) => {
    const btn = document.createElement('button');
    btn.className = `btn-nickname ${idx === 0 ? 'active' : ''}`;
    btn.textContent = user.nickname;
    btn.onclick = () => selectUser(user, btn);
    bar.appendChild(btn);

    if (idx === 0) selectedUser = user;
  });

  if (selectedUser) fetchAllData();
}

function selectUser(user, btnElement) {
  document.querySelectorAll('.btn-nickname').forEach(b => b.classList.remove('active'));
  btnElement.classList.add('active');
  selectedUser = user;
  document.getElementById('statusText').textContent = `${user.nickname} 님의 상대 전적 분석`;
  fetchAllData();
}

// 2. 서버에서 경기 상세 내역 & 최다 스트릭 데이터 가져오기
async function fetchAllData() {
  if (!selectedUser) return;

  // A. match_details 데이터 가져오기
  const { data: details, error: detailErr } = await supabaseClient
    .from('match_details')
    .select('*, matches(match_date, match_type)')
    .eq('ouid', selectedUser.ouid);

  // B. user_opponent_streaks 데이터 가져오기 (최다연승/연패용)
  const { data: streaks } = await supabaseClient
    .from('user_opponent_streaks')
    .select('*')
    .eq('ouid', selectedUser.ouid);

  if (detailErr) {
    console.error('데이터 불러오기 실패:', detailErr);
    return;
  }

  rawMatchDetails = details || [];

  streakDataMap.clear();
  if (streaks) {
    streaks.forEach(s => streakDataMap.set(s.opponent_ouid, s));
  }

  applyFiltersAndRender();
}

// 3. 필터링, 정렬 및 렌더링
function applyFiltersAndRender() {
  const matchType = document.getElementById('matchTypeSelect').value;
  const searchName = document.getElementById('searchOpponent').value.trim().toLowerCase();
  const startDate = document.getElementById('startDate').value;
  const endDate = document.getElementById('endDate').value;
  const sortType = document.getElementById('sortSelect').value;

  // 필터링 적용
  const filtered = rawMatchDetails.filter(d => {
    const matchDateStr = d.matches ? d.matches.match_date : (d.match_date || d.created_at);
    const mType = d.matches ? String(d.matches.match_type) : String(d.match_type || '');
    const opNick = (d.opponent_nick || '').toLowerCase();

    if (matchType !== 'ALL' && mType !== matchType) return false;
    if (searchName && !opNick.includes(searchName)) return false;
    if (startDate && new Date(matchDateStr) < new Date(startDate)) return false;
    if (endDate && new Date(matchDateStr) > new Date(endDate + 'T23:59:59')) return false;

    return true;
  });

  // 상대별 그룹화
  const groups = {};
  let grandTotalWins = 0;
  let grandTotalDraws = 0;
  let grandTotalLosses = 0;

  filtered.forEach(d => {
    const opOuid = d.opponent_ouid || 'UNKNOWN';
    const matchDateStr = d.matches ? d.matches.match_date : (d.match_date || d.created_at);

    if (!groups[opOuid]) {
      groups[opOuid] = {
        opOuid: opOuid,
        opNick: d.opponent_nick || '상대 미상',
        wins: 0,
        draws: 0,
        losses: 0,
        totalMatches: 0,
        lastDate: matchDateStr,
        history: []
      };
    }

    groups[opOuid].totalMatches++;
    groups[opOuid].history.push({
      date: matchDateStr,
      result: d.match_result,
      score: `${d.my_score || 0} : ${d.opponent_score || 0}`
    });

    if (d.match_result === '승') {
      groups[opOuid].wins++;
      grandTotalWins++;
    } else if (d.match_result === '패') {
      groups[opOuid].losses++;
      grandTotalLosses++;
    } else {
      groups[opOuid].draws++;
      grandTotalDraws++;
    }
  });

  // 요약 대시보드 업데이트
  const grandTotalCount = filtered.length;
  const grandWinRate = grandTotalCount > 0 ? ((grandTotalWins / grandTotalCount) * 100).toFixed(1) : 0;

  document.getElementById('totalMatchesCount').textContent = `${grandTotalCount}전`;
  document.getElementById('totalWinRate').textContent = `${grandWinRate}%`;
  document.getElementById('totalScoreText').textContent = `${grandTotalWins}승 ${grandTotalDraws}무 ${grandTotalLosses}패`;

  // 배열 변환 및 정렬
  let resultList = Object.values(groups);

  resultList.forEach(item => {
    item.winRate = item.totalMatches > 0 ? (item.wins / item.totalMatches) * 100 : 0;
  });

  if (sortType === 'RECENT') {
    resultList.sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
  } else if (sortType === 'MOST_MATCHES') {
    resultList.sort((a, b) => b.totalMatches - a.totalMatches);
  } else if (sortType === 'HIGH_WINRATE') {
    resultList.sort((a, b) => b.winRate - a.winRate);
  } else if (sortType === 'LOW_WINRATE') {
    resultList.sort((a, b) => a.winRate - b.winRate);
  }

  renderOpponentList(resultList);
}

// 4. 상대 리스트 UI 카드 생성 (기존 아코디언 상세 보기 + 최다 연승/연패 추가)
function renderOpponentList(opponentList) {
  const container = document.getElementById('opponentList');
  container.innerHTML = '';

  if (opponentList.length === 0) {
    container.innerHTML = '<p class="empty-msg">조건에 해당하는 전적 데이터가 없습니다.</p>';
    return;
  }

  opponentList.forEach((op, idx) => {
    const streakInfo = streakDataMap.get(op.opOuid) || {};
    const winRate = op.winRate.toFixed(1);

    const card = document.createElement('div');
    card.className = 'op-card';

    // 카드 내부 HTML
    card.innerHTML = `
      <div class="op-card-header">
        <span class="op-name">vs ${op.opNick}</span>
        <span class="op-winrate">승률 ${winRate}%</span>
      </div>

      <div class="op-score-bar">
        <div class="score-item win">${op.wins}승</div>
        <div class="score-item draw">${op.draws}무</div>
        <div class="score-item lose">${op.losses}패</div>
        <div class="score-total">(${op.totalMatches}전)</div>
      </div>

      <!-- ➕ 최다 연승 / 연패 / 무패 / 무승 추가 섹션 -->
      <div class="op-streak-wrapper">
        <div class="streak-row">
          <span>🔥 <b>최다 연승:</b> <span style="color: #2563eb; font-weight: bold;">${streakInfo.max_win_streak || 0}연승</span></span>
          <span>😭 <b>최다 연패:</b> <span style="color: #dc2626; font-weight: bold;">${streakInfo.max_lose_streak || 0}연패</span></span>
        </div>
        <div class="streak-row">
          <span>🛡️ <b>최다 무패:</b> ${streakInfo.max_unbeaten_streak || 0}경기</span>
          <span>⚠️ <b>최다 무승:</b> ${streakInfo.max_winless_streak || 0}경기</span>
        </div>
      </div>

      <!-- 클릭 시 개별 경기 기록 열기 -->
      <button class="details-toggle-btn" onclick="toggleDetails(${idx})">▼ 최근 경기 기록 보기</button>
      <div class="match-history-container" id="history-${idx}">
        ${op.history.map(h => `
          <div class="history-item">
            <span>${h.date ? h.date.slice(0, 10) : ''}</span>
            <span>${h.score}</span>
            <span class="history-result ${h.result === '승' ? 'win' : h.result === '패' ? 'lose' : 'draw'}">${h.result}</span>
          </div>
        `).join('')}
      </div>
    `;

    container.appendChild(card);
  });
}

// 상세 아코디언 토글 함수
window.toggleDetails = function(index) {
  const container = document.getElementById(`history-${index}`);
  if (container) {
    container.classList.toggle('open');
  }
};
