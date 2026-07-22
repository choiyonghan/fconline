const SUPABASE_URL = "https://jwqhpdtizrpyohlrqfgu.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_aXnxmQfcuNVBYdbjyHf8xQ_RsJTeBIL"; 

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const WOOK_NICKNAMES = ["지린성에사는욱구", "욱냥0I"];
let spidMetaMap = {}; 

// 1. 선수 메타데이터 로드
async function loadSpidMeta() {
  try {
    const res = await fetch("https://open.api.nexon.com/static/fconline/meta/spid.json");
    if (!res.ok) throw new Error("spid.json 로드 실패");
    const data = await res.json();
    data.forEach(item => { spidMetaMap[item.id] = item.name; });
  } catch (err) {
    console.error("SPID 메타데이터 가져오기 실패:", err);
  }
}

function getPlayerName(spId) {
  return spidMetaMap[spId] || `선수(ID:${spId})`;
}

// 2. 유저 로드 및 버튼 생성
async function fetchUsersAndInitButtons() {
  const statusEl = document.getElementById("status");
  const container = document.getElementById("nicknameButtons");
  await loadSpidMeta();
  try {
    const { data: users, error } = await db.from('users').select('nickname, ouid').order('nickname', { ascending: true });
    if (error) throw error;
    
    container.innerHTML = "";
    users.forEach(user => {
      const btn = document.createElement("button");
      btn.className = "btn-nickname";
      btn.innerText = user.nickname;
      btn.onclick = () => handleNicknameClick(user, btn);
      container.appendChild(btn);
    });
    statusEl.innerText = `총 ${users.length}명의 유저를 불러왔습니다. 분석할 닉네임을 클릭하세요.`;
  } catch (err) {
    console.error("유저 로드 에러:", err);
  }
}

// 3. 닉네임 클릭 처리 (단방향 조회 롤백)
async function handleNicknameClick(userObj, btnElement) {
  const statusEl = document.getElementById("status");
  const selectedNickname = userObj.nickname;
  const userOuid = userObj.ouid; // 이 유저의 고유 ID
  
  document.querySelectorAll(".btn-nickname").forEach(b => b.classList.remove("active"));
  btnElement.classList.add("active");
  document.getElementById("opponentList").style.display = "none";
  document.getElementById("summaryInfo").style.display = "none";
  document.getElementById("detailCard").style.display = "none";
  statusEl.innerText = "데이터 분석 중...";

  try {
    // 💡 질문하신 부분! 여기서 해당 유저의 ouid와 일치하는 경기만 가져옵니다.
    const { data: matchDetails, error } = await db.from('match_details')
      .select('*')
      .eq('ouid', userOuid) 
      .order('id', { ascending: false });

    if (error) throw error;
    if (!matchDetails || matchDetails.length === 0) {
      statusEl.innerText = "전적 데이터가 없습니다.";
      return;
    }

    let minDate = new Date();
    let maxDate = new Date(0);
    
    const opponentGroup = {};
    matchDetails.forEach(detail => {
      const dtStr = detail.match_date || detail.created_at;
      if (dtStr) {
        const d = new Date(dtStr);
        if(d < minDate) minDate = d;
        if(d > maxDate) maxDate = d;
      }

      const opName = detail.opponent_nick || "상대 미상";
      if (!opponentGroup[opName]) {
        opponentGroup[opName] = { 
          total: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, 
          posSum: 0, shootSum: 0, effShootSum: 0, matches: [] 
        };
      }
      
      const group = opponentGroup[opName];
      group.total += 1;
      
      const mResult = detail.match_result;
      if (mResult === "승") group.wins += 1;
      else if (mResult === "무") group.draws += 1;
      else if (mResult === "패") group.losses += 1;
      
      group.goalsFor += (detail.goals_for || 0);
      group.goalsAgainst += (detail.goals_against || 0);
      group.posSum += (detail.possession || 0);
      group.shootSum += (detail.shoot_total || 0);
      group.effShootSum += (detail.effective_shoot || 0);
      
      group.matches.push(detail);
    });

    const dateStr = minDate <= maxDate ? `${minDate.toLocaleDateString()} ~ ${maxDate.toLocaleDateString()}` : "날짜 정보 없음";
    document.getElementById("dateRange").innerText = `📅 분석 기간: ${dateStr}`;
    document.getElementById("summaryInfo").style.display = "block";

    renderOpponentCards(selectedNickname, opponentGroup);
    statusEl.innerText = `분석 완료! 상대를 선택해 상세 전적을 확인하세요.`;
  } catch (err) {
    console.error("매치 데이터 로드 에러:", err);
    statusEl.innerText = "오류가 발생했습니다.";
  }
}

// 4. 모바일 최적화 상대 카드 리스트 렌더링 (욱식점수 나 위주로 수정)
function renderOpponentCards(selectedNickname, opponentGroup) {
  const container = document.getElementById("opponentList");
  container.innerHTML = "";
  
  const isSelectedWook = WOOK_NICKNAMES.includes(selectedNickname);
  const sortedOpponents = Object.keys(opponentGroup).sort((a, b) => opponentGroup[b].total - opponentGroup[a].total);

  sortedOpponents.forEach((opName) => {
    const stat = opponentGroup[opName];
    const total = stat.total;
    const winRate = ((stat.wins/total)*100).toFixed(1);
    const avgPoss = (stat.posSum / total).toFixed(1);
    const avgShoot = (stat.shootSum / total).toFixed(1);
    const avgEffShoot = (stat.effShootSum / total).toFixed(1);

    const isOpWook = WOOK_NICKNAMES.includes(opName);
    const hasWook = isSelectedWook || isOpWook;
    let wookHtml = "";

    if (hasWook) {
      // 💡 욱식 점수 계산: 내 점수(클릭한 유저)를 먼저 배치
      let myScore = (stat.wins * 5) + (stat.draws * 3) + (stat.losses * 1);
      let opScore = (stat.losses * 5) + (stat.draws * 3) + (stat.wins * 1);
      let winnerText = myScore > opScore ? "승리! 🎉" : (myScore < opScore ? "패배..." : "무승부 🤝");
      
      wookHtml = `<div class="wook-badge-box">🏆 욱식 점수: ${myScore}점 vs ${opScore}점 (${winnerText})</div>`;
    }

    const card = document.createElement("div");
    card.className = `op-card ${hasWook ? 'wook-card' : ''}`;
    
    card.innerHTML = `
      <div class="op-card-header">
        <div class="op-name">${opName}</div>
        <div class="op-winrate">승률 ${winRate}%</div>
      </div>
      <div class="op-card-stats">
        <div class="op-stat-item">
          <div style="color:var(--text-muted)">전적</div>
          <div class="op-stat-val"><span class="win-text">${stat.wins}승</span> ${stat.draws}무 <span class="lose-text">${stat.losses}패</span></div>
        </div>
        <div class="op-stat-item">
          <div style="color:var(--text-muted)">평균 점유율</div>
          <div class="op-stat-val">${avgPoss}%</div>
        </div>
        <div class="op-stat-item">
          <div style="color:var(--text-muted)">유효/총 슈팅</div>
          <div class="op-stat-val">${avgEffShoot} / ${avgShoot}</div>
        </div>
      </div>
      ${wookHtml}
    `;

    card.onclick = () => {
      document.querySelectorAll(".op-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      renderDetailCard(selectedNickname, opName, stat);
    };

    container.appendChild(card);
  });
  
  container.style.display = "grid";
}

// 5. 연승/무패 계산 및 상세 분석 렌더링
function renderDetailCard(userNick, opponentNick, stat) {
  const detailCard = document.getElementById("detailCard");
  const matches = stat.matches;
  const totalMatches = matches.length;
  
  document.getElementById("detailTitle").innerText = `'${userNick}' vs '${opponentNick}'`;
  document.getElementById("matchCountBadge").innerText = `총 ${totalMatches}경기`;
  document.getElementById("winRateBadge").innerText = `승률 ${((stat.wins/totalMatches)*100).toFixed(1)}%`;

  let winS = 0, loseS = 0, unbeatenS = 0;
  for (let m of matches) { if (m.match_result === '승') winS++; else break; }
  for (let m of matches) { if (m.match_result === '패') loseS++; else break; }
  for (let m of matches) { if (m.match_result === '승' || m.match_result === '무') unbeatenS++; else break; }

  let streakEl = document.getElementById("streakBadge");
  streakEl.className = "streak-badge"; 
  if (winS > 0) {
    streakEl.innerText = unbeatenS > winS ? `${winS}연승 중! 🔥 (${unbeatenS}경기 무패)` : `${winS}연승 중! 🔥`;
    streakEl.classList.add("good");
  } else if (loseS > 0) {
    streakEl.innerText = `${loseS}연패 중... 😭`;
  } else if (unbeatenS > 0) {
    streakEl.innerText = `${unbeatenS}경기 무패 중 🛡️`;
    streakEl.classList.add("good");
  } else {
    streakEl.innerText = "진행 중인 연승/연패 없음";
    streakEl.classList.add("neutral");
  }

  const goalMap = {}, assistMap = {}, saveMap = {};
  let validSquadMatchCount = 0;

  matches.forEach(m => {
    const squad = m.player_squad || m.player_squid || [];
    if (squad.length > 0) validSquadMatchCount++;

    squad.forEach(p => {
      if (p.spPosition === 28) return; 
      const spId = p.spId || p.spid;
      if (!spId || spId === 0) return;
      const st = p.status || p;

      const g = Number(st.goal || 0);
      if (g > 0) goalMap[spId] = (goalMap[spId] || 0) + g;

      const a = Number(st.assist || 0);
      if (a > 0) assistMap[spId] = (assistMap[spId] || 0) + a;

      const sv = Number(st.save || st.defending || 0); 
      if (sv > 0) saveMap[spId] = (saveMap[spId] || 0) + sv;
    });
  });

  const getTopPlayer = (map) => {
    let topId = null, maxVal = 0;
    for (const id in map) { if (map[id] > maxVal) { maxVal = map[id]; topId = id; } }
    return { id: topId, count: maxVal };
  };

  const topScorer = getTopPlayer(goalMap);
  const topAssister = getTopPlayer(assistMap);
  const topSaver = getTopPlayer(saveMap);

  const avgGoalsFor = (stat.goalsFor / totalMatches).toFixed(1);
  const avgGoalsAgainst = (stat.goalsAgainst / totalMatches).toFixed(1);
  document.getElementById("avgGoals").innerText = `⚽ ${avgGoalsFor}골 / 🛡️ ${avgGoalsAgainst}실점`;
  document.getElementById("totalGoalsSub").innerText = `총 ${stat.goalsFor}득점 / 총 ${stat.goalsAgainst}실점`;

  const setMetric = (nameId, detailId, topObj, unit) => {
    if (topObj.id && validSquadMatchCount > 0) {
      document.getElementById(nameId).innerText = getPlayerName(topObj.id);
      document.getElementById(detailId).innerText = `${validSquadMatchCount}경기 ${topObj.count}${unit} (평균 ${(topObj.count / validSquadMatchCount).toFixed(2)}${unit})`;
    } else {
      document.getElementById(nameId).innerText = "기록 없음";
      document.getElementById(detailId).innerText = "(직접 갱신한 전적 필요)";
    }
  };

  setMetric("topScorerName", "topScorerDetail", topScorer, "골");
  setMetric("topAssisterName", "topAssisterDetail", topAssister, "도움");
  setMetric("topDefenderName", "topDefenderDetail", topSaver, "선방");

  detailCard.style.display = "block";
  detailCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.onload = fetchUsersAndInitButtons;
