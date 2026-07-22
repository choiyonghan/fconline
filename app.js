// ============================================================
// 1. 설정 및 상태 변수
// ============================================================
// TODO: 본인의 Supabase URL과 Anon Key로 변경해주세요.
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

let supabaseClient = null;
if (typeof supabase !== 'undefined' && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// 상태 관리
let currentNickname = '';
let rawMatchData = [];
let filteredMatchData = [];
let playerMetaMap = {}; // spid -> 선수 이름/클래스 메타데이터

// ============================================================
// 2. 초기화 (DOM Loaded)
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  await loadPlayerMetaData();
  // 닉네임 목록이 있다면 초기화 시 생성
  initNicknameButtons(['유저1', '유저2', '유저3']); 
});

function initEventListeners() {
  const btnSearch = document.getElementById('btnSearchDate');
  const btnReset = document.getElementById('btnResetDate');

  if (btnSearch) btnSearch.addEventListener('click', filterDataByDate);
  if (btnReset) btnReset.addEventListener('click', resetDateFilter);
}

// ============================================================
// 3. 선수 메타데이터 로드
// ============================================================
async function loadPlayerMetaData() {
  const statusEl = document.getElementById('status');
  try {
    const res = await fetch('https://open.api.nexon.com/static/fconline/meta/spid.json');
    if (!res.ok) throw new Error('메타데이터 로드 실패');
    const data = await res.json();
    
    data.forEach(item => {
      playerMetaMap[item.id] = item.name;
    });
    
    if (statusEl) statusEl.textContent = '닉네임을 선택하여 전적을 조회하세요.';
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = '메타데이터 로드 중 오류가 발생했습니다.';
  }
}

// ============================================================
// 4. 닉네임 버튼 생성 및 데이터 불러오기
// ============================================================
function initNicknameButtons(nicknames) {
  const container = document.getElementById('nicknameButtons');
  if (!container) return;
  container.innerHTML = '';

  nicknames.forEach((nick, index) => {
    const btn = document.createElement('button');
    btn.className = 'btn-nickname';
    btn.textContent = nick;
    btn.onclick = () => selectNickname(nick, btn);
    container.appendChild(btn);

    // 첫 번째 닉네임 자동 선택
    if (index === 0) selectNickname(nick, btn);
  });
}

async function selectNickname(nickname, btnElement) {
  currentNickname = nickname;
  
  // 버튼 활성화 스타일
  document.querySelectorAll('.btn-nickname').forEach(b => b.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');

  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = `${nickname} 님의 전적 데이터를 불러오는 중...`;

  // 데이터 가상 로드 또는 Supabase 조회
  await fetchMatchData(nickname);
}

async function fetchMatchData(nickname) {
  // Supabase가 설정된 경우 실제 데이터 조회
  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from('match_records')
      .select('*')
      .eq('user_nickname', nickname)
      .order('match_date', { ascending: false });

    if (error) {
      console.error(error);
      document.getElementById('status').textContent = '데이터를 불러오는 데 실패했습니다.';
      return;
    }
    rawMatchData = data || [];
  } else {
    // 테스트용 샘플 데이터 (Supabase 미연결 시 사용)
    rawMatchData = getSampleData(nickname);
  }

  filteredMatchData = [...rawMatchData];
  
  document.getElementById('status').textContent = '';
  document.getElementById('summaryInfo').style.display = 'block';
  
  updateDateRangeUI();
  renderOpponentList();
}

// ============================================================
// 5. 날짜 필터링 로직
// ============================================================
function updateDateRangeUI() {
  const dateRangeEl = document.getElementById('dateRange');
  if (!filteredMatchData.length) {
    dateRangeEl.textContent = '전적 데이터 없음';
    return;
  }

  const dates = filteredMatchData.map(d => d.match_date).sort();
  const start = dates[0].substring(0, 10);
  const end = dates[dates.length - 1].substring(0, 10);

  dateRangeEl.textContent = start === end ? start : `${start} ~ ${end}`;
}

function filterDataByDate() {
  const startDate = document.getElementById('startDate').value;
  const endDate = document.getElementById('endDate').value;

  if (!startDate && !endDate) {
    alert('조회할 날짜를 선택해주세요.');
    return;
  }

  filteredMatchData = rawMatchData.filter(item => {
    const itemDate = item.match_date.substring(0, 10);
    if (startDate && itemDate < startDate) return false;
    if (endDate && itemDate > endDate) return false;
    return true;
  });

  // 상세 카드가 열려있었다면 닫기
  const detailCard = document.getElementById('detailCard');
  if (detailCard) detailCard.style.display = 'none';

  updateDateRangeUI();
  renderOpponentList();
}

function resetDateFilter() {
  document.getElementById('startDate').value = '';
  document.getElementById('endDate').value = '';
  filteredMatchData = [...rawMatchData];

  const detailCard = document.getElementById('detailCard');
  if (detailCard) detailCard.style.display = 'none';

  updateDateRangeUI();
  renderOpponentList();
}

// ============================================================
// 6. 상대 리스트 렌더링 & 🪗 아코디언 토글 로직
// ============================================================
function renderOpponentList() {
  const listEl = document.getElementById('opponentList');
  if (!listEl) return;
  listEl.innerHTML = '';
  listEl.style.display = 'grid';

  // 상대별 데이터 집계
  const opponentMap = {};
  filteredMatchData.forEach(match => {
    const opName = match.opponent_name || '상대 미상';
    if (!opponentMap[opName]) {
      opponentMap[opName] = { name: opName, matches: [] };
    }
    opponentMap[opName].matches.push(match);
  });

  const opponents = Object.values(opponentMap);

  if (opponents.length === 0) {
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;">해당 기간의 경기 기록이 없습니다.</div>';
    return;
  }

  opponents.forEach(op => {
    const card = createOpponentCard(op);
    listEl.appendChild(card);
  });
}

function createOpponentCard(opData) {
  const totalMatches = opData.matches.length;
  let wins = 0, draws = 0, losses = 0;

  opData.matches.forEach(m => {
    if (m.result === '승') wins++;
    else if (m.result === '무') draws++;
    else losses++;
  });

  const winRate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : '0.0';

  const card = document.createElement('div');
  card.className = 'op-card';

  card.innerHTML = `
    <div class="op-card-header">
      <span class="op-name">VS ${opData.name}</span>
      <span class="op-winrate">승률 ${winRate}%</span>
    </div>
    <div class="op-card-stats">
      <div class="op-stat-item">
        <div>전적</div>
        <div class="op-stat-val">${totalMatches}전</div>
      </div>
      <div class="op-stat-item">
        <div>승/무/패</div>
        <div class="op-stat-val"><span class="win-text">${wins}승</span> ${draws}무 <span class="lose-text">${losses}패</span></div>
      </div>
      <div class="op-stat-item">
        <div>승률</div>
        <div class="op-stat-val">${winRate}%</div>
      </div>
    </div>
  `;

  // 🪗 핵심: 아코디언 클릭 이벤트 등록
  card.addEventListener('click', () => handleCardAccordionToggle(card, opData));

  return card;
}

// 🪗 아코디언 동작 처리 함수
function handleCardAccordionToggle(cardElement, opData) {
  const detailCard = document.getElementById('detailCard');
  if (!detailCard) return;

  const isAlreadySelected = cardElement.classList.contains('selected');
  const isCardVisible = detailCard.style.display !== 'none';

  // 1. 이미 선택된 카드를 다시 클릭 시 -> 닫기 (토글)
  if (isAlreadySelected && isCardVisible) {
    detailCard.style.display = 'none';
    cardElement.classList.remove('selected');
    return;
  }

  // 2. 다른 카드들의 활성화 스타일 해제
  document.querySelectorAll('.op-card').forEach(c => c.classList.remove('selected'));

  // 3. 현재 카드 선택 스타일 적용
  cardElement.classList.add('selected');

  // 4. 클릭한 카드 바로 뒤(하단)로 detailCard 이동
  cardElement.after(detailCard);

  // 5. 상세 데이터 계산 및 UI 채우기
  renderDetailContent(opData);

  // 6. 상세 카드 노출
  detailCard.style.display = 'block';

  // 7. 클릭 위치로 스무스하게 스크롤 이동
  cardElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================
// 7. 상세 분석 데이터 렌더링
// ============================================================
function renderDetailContent(opData) {
  const matches = opData.matches;
  const totalCount = matches.length;

  let totalGoals = 0;
  let totalConceded = 0;
  let wins = 0;

  const scorerMap = {};
  const assisterMap = {};
  const defenderMap = {};

  matches.forEach(m => {
    if (m.result === '승') wins++;
    totalGoals += m.goals || 0;
    totalConceded += m.conceded || 0;

    // 득점자 집계
    if (Array.isArray(m.scorers)) {
      m.scorers.forEach(s => {
        const id = s.spid || s.name;
        if (!scorerMap[id]) scorerMap[id] = { id, name: getPlayerName(id), count: 0, matches: new Set() };
        scorerMap[id].count += (s.count || 1);
        scorerMap[id].matches.add(m.id);
      });
    }

    // 어시스트 집계
    if (Array.isArray(m.assisters)) {
      m.assisters.forEach(a => {
        const id = a.spid || a.name;
        if (!assisterMap[id]) assisterMap[id] = { id, name: getPlayerName(id), count: 0, matches: new Set() };
        assisterMap[id].count += (a.count || 1);
        assisterMap[id].matches.add(m.id);
      });
    }

    // 선방(수비) 집계
    if (Array.isArray(m.defenders)) {
      m.defenders.forEach(d => {
        const id = d.spid || d.name;
        if (!defenderMap[id]) defenderMap[id] = { id, name: getPlayerName(id), count: 0, matches: new Set() };
        defenderMap[id].count += (d.count || 1);
        defenderMap[id].matches.add(m.id);
      });
    }
  });

  const winRate = totalCount > 0 ? ((wins / totalCount) * 100).toFixed(1) : '0.0';
  const avgGoals = totalCount > 0 ? (totalGoals / totalCount).toFixed(1) : '0.0';
  const avgConceded = totalCount > 0 ? (totalConceded / totalCount).toFixed(1) : '0.0';

  // UI 업데이트
  document.getElementById('detailTitle').textContent = `VS ${opData.name} 상세 리포트`;
  document.getElementById('matchCountBadge').textContent = `총 ${totalCount}경기`;
  document.getElementById('winRateBadge').textContent = `승률 ${winRate}%`;

  // 연승/연패 뱃지 계산
  const streakBadge = document.getElementById('streakBadge');
  const streakInfo = calculateStreak(matches);
  streakBadge.textContent = streakInfo.text;
  streakBadge.className = `streak-badge ${streakInfo.type}`;

  // 득/실점
  document.getElementById('avgGoals').textContent = `평균 ${avgGoals}득점 / ${avgConceded}실점`;
  document.getElementById('totalGoalsSub').textContent = `총 ${totalGoals}득점 / 총 ${totalConceded}실점`;

  // 주요 선수 지표 업데이트
  updateTopPlayerUI('topScorerName', 'topScorerDetail', Object.values(scorerMap), '골');
  updateTopPlayerUI('topAssisterName', 'topAssisterDetail', Object.values(assisterMap), '도움');
  updateTopPlayerUI('topDefenderName', 'topDefenderDetail', Object.values(defenderMap), '선방');
}

function updateTopPlayerUI(nameId, detailId, list, unit) {
  const nameEl = document.getElementById(nameId);
  const detailEl = document.getElementById(detailId);

  if (!list || list.length === 0) {
    nameEl.textContent = '-';
    detailEl.textContent = `기록된 ${unit} 정보가 없습니다.`;
    return;
  }

  // 최다 기록 선수 찾기
  list.sort((a, b) => b.count - a.count);
  const top = list[0];
  const playedCount = top.matches.size || 1;
  const avg = (top.count / playedCount).toFixed(1);

  nameEl.textContent = top.name;
  detailEl.textContent = `${playedCount}경기 ${top.count}${unit} (평균 ${avg}${unit})`;
}

function getPlayerName(spid) {
  return playerMetaMap[spid] || spid || '알 수 없는 선수';
}

function calculateStreak(matches) {
  if (!matches || matches.length === 0) return { text: '기록 없음', type: 'neutral' };

  let currentResult = matches[0].result;
  let count = 0;

  for (let m of matches) {
    if (m.result === currentResult) count++;
    else break;
  }

  if (currentResult === '승') return { text: `🔥 현재 ${count}연승 중`, type: 'good' };
  if (currentResult === '패') return { text: `💦 현재 ${count}연패 중`, type: '' };
  return { text: `➖ 최근 무승부`, type: 'neutral' };
}

// ============================================================
// 8. 테스트용 샘플 데이터 (Supabase 미연결 시 fallback)
// ============================================================
function getSampleData(nickname) {
  return [
    {
      id: 1,
      user_nickname: nickname,
      opponent_name: '강력한상대',
      result: '승',
      goals: 3,
      conceded: 1,
      match_date: '2026-03-20 14:00:00',
      scorers: [{ spid: 101000001, count: 2 }, { spid: 101000002, count: 1 }],
      assisters: [{ spid: 101000002, count: 2 }],
      defenders: [{ spid: 101000003, count: 4 }]
    },
    {
      id: 2,
      user_nickname: nickname,
      opponent_name: '강력한상대',
      result: '패',
      goals: 0,
      conceded: 2,
      match_date: '2026-03-21 16:30:00',
      scorers: [],
      assisters: [],
      defenders: [{ spid: 101000003, count: 2 }]
    },
    {
      id: 3,
      user_nickname: nickname,
      opponent_name: '라이벌친구',
      result: '승',
      goals: 2,
      conceded: 2,
      match_date: '2026-03-22 18:00:00',
      scorers: [{ spid: 101000001, count: 2 }],
      assisters: [{ spid: 101000002, count: 1 }],
      defenders: [{ spid: 101000003, count: 5 }]
    }
  ];
}
