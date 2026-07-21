// app.js (전체 코드)

const SUPABASE_URL = "https://jwqhpdtizrpyohlrqfgu.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_aXnxmQfcuNVBYdbjyHf8xQ_RsJTeBIL"; 
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const WOOK_NICKNAMES = ["지린성에사는욱구", "욱냥0I"];
let spidMetaMap = {}; 

async function loadSpidMeta() {
  const res = await fetch("https://open.api.nexon.com/static/fconline/meta/spid.json");
  const data = await res.json();
  data.forEach(item => { spidMetaMap[item.id] = item.name; });
}

function getPlayerName(spId) { return spidMetaMap[spId] || `선수(ID:${spId})`; }

// 1. 유저 리스트 로드 (모바일 버튼 UI)
async function fetchUsersAndInitButtons() {
  await loadSpidMeta();
  const { data: users } = await db.from('users').select('nickname, ouid').order('nickname', { ascending: true });
  const container = document.getElementById("nicknameButtons");
  container.innerHTML = "";
  users.forEach(user => {
    const btn = document.createElement("button");
    btn.className = "btn-nickname";
    btn.innerText = user.nickname;
    btn.onclick = () => handleNicknameClick(user, btn);
    container.appendChild(btn);
  });
}

// 2. 매치 데이터 조회 및 그룹화
async function handleNicknameClick(userObj, btnElement) {
  document.querySelectorAll(".btn-nickname").forEach(b => b.classList.remove("active"));
  btnElement.classList.add("active");

  const { data: matchDetails } = await db.from('match_details').select('*').eq('ouid', userObj.ouid).order('id', { ascending: false });
  
  const opponentGroup = {};
  matchDetails.forEach(detail => {
    const op = detail.opponent_nick || "상대 미상";
    if (!opponentGroup[op]) opponentGroup[op] = { total:0, wins:0, draws:0, losses:0, goalsFor:0, goalsAgainst:0, posSum:0, shootSum:0, effShootSum:0, matches:[] };
    
    const g = opponentGroup[op];
    g.total += 1;
    if (detail.match_result === "승") g.wins += 1;
    else if (detail.match_result === "무") g.draws += 1;
    else g.losses += 1;
    g.goalsFor += (detail.goals_for || 0);
    g.goalsAgainst += (detail.goals_against || 0);
    g.posSum += (detail.possession || 0);
    g.shootSum += (detail.shoot_total || 0);
    g.effShootSum += (detail.effective_shoot || 0);
    g.matches.push(detail);
  });
  renderGroupedTable(userObj.nickname, opponentGroup);
}

// 3. 모바일 최적화 테이블 렌더링
function renderGroupedTable(myNick, opponentGroup) {
  const tbody = document.getElementById("resultTableBody");
  tbody.innerHTML = "";
  
  Object.keys(opponentGroup).forEach(opName => {
    const stat = opponentGroup[opName];
    const isWook = WOOK_NICKNAMES.includes(myNick) || WOOK_NICKNAMES.includes(opName);
    
    // 욱식 점수 계산 로직
    const wWins = WOOK_NICKNAMES.includes(myNick) ? stat.wins : stat.losses;
    const wLoss = WOOK_NICKNAMES.includes(myNick) ? stat.losses : stat.wins;
    const wScore = (wWins * 5) + (stat.draws * 3) + (wLoss * 1);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${opName}<br><small>${isWook ? '🏆욱식:'+wScore : '-'}</small></td>
      <td>${stat.total}경기<br>${stat.wins}승${stat.draws}무${stat.losses}패</td>
      <td>${(stat.posSum/stat.total).toFixed(0)}%<br>${(stat.effShootSum/stat.total).toFixed(1)}/${(stat.shootSum/stat.total).toFixed(1)}</td>
    `;
    row.onclick = () => renderDetailCard(myNick, opName, stat);
    tbody.appendChild(row);
  });
  document.getElementById("tableContainer").style.display = "block";
}

// 4. 상세 분석 카드 (모바일 그리드 UI)
function renderDetailCard(myNick, opName, stat) {
  const total = stat.matches.length;
  const goalMap={}, assistMap={}, saveMap={};

  stat.matches.forEach(m => {
    (m.player_squad || m.player_squid || []).forEach(p => {
      if (p.spPosition === 28) return;
      const id = p.spId || p.spid;
      const st = p.status || p;
      goalMap[id] = (goalMap[id] || 0) + Number(st.goal || 0);
      assistMap[id] = (assistMap[id] || 0) + Number(st.assist || 0);
      saveMap[id] = (saveMap[id] || 0) + (Number(st.defending || st.tackle || 0) + Number(st.intercept || 0) + Number(st.block || 0));
    });
  });

  const getTop = (map) => {
    let id = Object.keys(map).reduce((a, b) => map[a] > map[b] ? a : b, null);
    return { name: getPlayerName(id), val: map[id] || 0, avg: ((map[id] || 0) / total).toFixed(1) };
  };

  const tG = getTop(goalMap), tA = getTop(assistMap), tS = getTop(saveMap);

  document.getElementById("detailCard").innerHTML = `
    <h4>${myNick} vs ${opName}</h4>
    <p>총 ${total}경기 | ${stat.goalsFor}득점 ${stat.goalsAgainst}실점</p>
    <div class="stat-grid">
      <div class="stat-box"><b>최다 득점</b><br>${tG.name}<br>${tG.val} (${tG.avg})</div>
      <div class="stat-box"><b>최다 도움</b><br>${tA.name}<br>${tA.val} (${tA.avg})</div>
      <div class="stat-box"><b>최다 선방</b><br>${tS.name}<br>${tS.val} (${tS.avg})</div>
    </div>
  `;
  document.getElementById("detailCard").style.display = "block";
}
