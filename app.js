const SUPABASE_URL = "https://jwqhpdtizrpyohlrqfgu.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_aXnxmQfcuNVBYdbjyHf8xQ_RsJTeBIL"; 

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const WOOK_NICKNAMES = ["지린성에사는욱구", "욱냥0I"];
let spidMetaMap = {}; 

let currentSelectedUser = null;
let rawMatchDetails = []; 

function parseToKst(utcDateString) {
  if (!utcDateString) return null;
  return new Date(utcDateString);
}

function formatDateToKstString(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return "날짜 정보 없음";
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

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

async function fetchUsersAndInitButtons() {
  const statusEl = document.getElementById("status");
  const container = document.getElementById("nicknameButtons");
  await loadSpidMeta();
  
  document.getElementById("btnSearchDate").addEventListener("click", applyDateFilter);
  document.getElementById("btnResetDate").addEventListener("click", resetDateFilter);

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
    statusEl.innerText = `총 ${users.length}명의 유저 로드 완료`;
  } catch (err) {
    console.error("유저 로드 에러:", err);
  }
}

async function handleNicknameClick(userObj, btnElement) {
  const statusEl = document.getElementById("status");
  currentSelectedUser = userObj;
  
  document.querySelectorAll(".btn-nickname").forEach(b => b.classList.remove("active"));
  btnElement.classList.add("active");
  
  const detailCard = document.getElementById("detailCard");
  const opponentList = document.getElementById("opponentList");
  if (detailCard && opponentList && opponentList.contains(detailCard)) {
    opponentList.after(detailCard);
  }

  opponentList.style.display = "none";
  document.getElementById("summaryInfo").style.display = "none";
  if (detailCard) detailCard.style.display = "none";
  document.getElementById("overallStatsContainer").innerHTML = "";
  
  document.getElementById("startDate").value = "";
  document.getElementById("endDate").value = "";
  
  statusEl.innerText = "데이터 계산 중...";

  try {
    const { data: matchDetails, error } = await db.from('match_details')
      .select('*, matches(match_date)')
      .eq('ouid', userObj.ouid) 
      .order('id', { ascending: false });

    if (error) throw error;
    if (!matchDetails || matchDetails.length === 0) {
      statusEl.innerText = "전적 데이터가 없습니다.";
      return;
    }

    rawMatchDetails = matchDetails.map(item => {
      const realMatchDate = item.matches ? item.matches.match_date : (item.match_date || item.created_at);
      return {
        ...item,
        real_match_date: realMatchDate
      };
    });

    processAndRenderMatches(rawMatchDetails);
    statusEl.innerText = `분석 완료! 상대를 선택하세요.`;
  } catch (err) {
    console.error("매치 데이터 로드 에러:", err);
    statusEl.innerText = "오류가 발생했습니다.";
  }
}

function applyDateFilter() {
  if (!rawMatchDetails || rawMatchDetails.length === 0) return;

  const startVal = document.getElementById("startDate").value;
  const endVal = document.getElementById("endDate").value;

  if (!startVal && !endVal) {
    processAndRenderMatches(rawMatchDetails);
    return;
  }

  const startTarget = startVal ? new Date(`${startVal}T00:00:00+09:00`) : new Date(0);
  const endTarget = endVal ? new Date(`${endVal}T23:59:59+09:00`) : new Date("2099-12-31");

  const filteredMatches = rawMatchDetails.filter(detail => {
    if (!detail.real_match_date) return false;
    const kstDate = parseToKst(detail.real_match_date);
    return kstDate >= startTarget && kstDate <= endTarget;
  });

  const statusEl = document.getElementById("status");
  if (filteredMatches.length === 0) {
    statusEl.innerText = "해당 기간 내 경기 데이터가 없습니다.";
    document.getElementById("opponentList").style.display = "none";
    document.getElementById("detailCard").style.display = "none";
    document.getElementById("overallStatsContainer").innerHTML = "";
    return;
  }

  statusEl.innerText = `필터 적용 (${filteredMatches.length}경기)`;
  processAndRenderMatches(filteredMatches);
}

function resetDateFilter() {
  document.getElementById("startDate").value = "";
  document.getElementById("endDate").value = "";
  if (rawMatchDetails && rawMatchDetails.length > 0) {
    document.getElementById("status").innerText = "전체 기간으로 조회합니다.";
    processAndRenderMatches(rawMatchDetails);
  }
}

function processAndRenderMatches(matchList) {
  let minDate = new Date("2099-12-31");
  let maxDate = new Date(0);
  
  const opponentGroup = {};
  
  matchList.forEach(detail => {
    const dtStr = detail.real_match_date;
    if (dtStr) {
      const kstDate = parseToKst(dtStr);
      if (kstDate < minDate) minDate = kstDate;
      if (kstDate > maxDate) maxDate = kstDate;
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

  const dateStr = (minDate <= maxDate && minDate.getFullYear() !== 2099)
    ? `${formatDateToKstString(minDate)} ~ ${formatDateToKstString(maxDate)}` 
    : "날짜 정보 없음";
    
  document.getElementById("dateRange").innerText = `📅 분석 기간 (KST): ${dateStr}`;
  document.getElementById("summaryInfo").style.display = "block";
  document.getElementById("detailCard").style.display = "none";

  renderOverallStats(currentSelectedUser.nickname, matchList);
  renderOpponentCards(currentSelectedUser.nickname, opponentGroup);
}

function renderOverallStats(userNick, matches) {
  const container = document.getElementById("overallStatsContainer");
  if (!container) return;

  const totalMatches = matches.length;
  if (totalMatches === 0) {
    container.innerHTML = "";
    return;
  }

  let wins = 0, draws = 0, losses = 0;
  let goalsFor = 0, goalsAgainst = 0;
  let posSum = 0, shootSum = 0, effShootSum = 0;
  
  const goalMap = {}, assistMap = {}, saveMap = {}, appMap = {};

  matches.forEach(m => {
    if (m.match_result === '승') wins++;
    else if (m.match_result === '무') draws++;
    else if (m.match_result === '패') losses++;

    goalsFor += (m.goals_for || 0);
    goalsAgainst += (m.goals_against || 0);
    posSum += (m.possession || 0);
    shootSum += (m.shoot_total || 0);
    effShootSum += (m.effective_shoot || 0);

    const squad = m.player_squad || m.player_squid || [];
    squad.forEach(p => {
      if (p.spPosition === 28) return; 
      const spId = p.spId || p.spid;
      if (!spId || spId === 0) return;
      
      appMap[spId] = (appMap[spId] || 0) + 1;
      
      const st = p.status || p;
      const g = Number(st.goal || 0);
      if (g > 0) goalMap[spId] = (goalMap[spId] || 0) + g;

      const a = Number(st.assist || 0);
      if (a > 0) assistMap[spId] = (assistMap[spId] || 0) + a;

      const sv = Number(st.save || st.defending || 0); 
      if (sv > 0) saveMap[spId] = (saveMap[spId] || 0) + sv;
    });
  });

  const winRate = ((wins / totalMatches) * 100).toFixed(1);
  const avgGoalsFor = (goalsFor / totalMatches).toFixed(1);
  const avgGoalsAgainst = (goalsAgainst / totalMatches).toFixed(1);

  container.innerHTML = `
    <div style="background:#fff; border-radius:10px; padding:12px; border:1px solid #cbd5e1;">
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <strong style="font-size:0.9rem;">👑 '${userNick}' 종합 전적</strong>
        <span style="color:var(--primary-color); font-weight:bold; font-size:0.9rem;">승률 ${winRate}%</span>
      </div>
      <div style="font-size:0.8rem; color:#475569;">
        ${totalMatches}전 <span class="win-text">${wins}승</span> ${draws}무 <span class="lose-text">${losses}패</span> 
        (⚽ 평균 ${avgGoalsFor}득 / 🛡️ ${avgGoalsAgainst}실)
      </div>
    </div>
  `;
}

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

    const card = document.createElement("div");
    card.className = 'op-card';
    
    card.innerHTML = `
      <div class="op-card-header">
        <div class="op-name">${opName}</div>
        <div class="op-winrate">승률 ${winRate}%</div>
      </div>
      <div class="op-card-stats">
        <div>
          <div style="color:var(--text-muted)">전적</div>
          <div><span class="win-text">${stat.wins}승</span> ${stat.draws}무 <span class="lose-text">${stat.losses}패</span></div>
        </div>
        <div>
          <div style="color:var(--text-muted)">점유율</div>
          <div>${avgPoss}%</div>
        </div>
        <div>
          <div style="color:var(--text-muted)">슈팅</div>
          <div>${avgShoot}개</div>
        </div>
      </div>
    `;

    card.onclick = () => {
      const detailCard = document.getElementById("detailCard");
      const isAlreadySelected = card.classList.contains("selected");
      const isDetailVisible = detailCard.style.display !== "none";

      if (isAlreadySelected && isDetailVisible) {
        detailCard.style.display = "none";
        card.classList.remove("selected");
        return;
      }

      document.querySelectorAll(".op-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");

      card.after(detailCard);

      renderDetailCard(selectedNickname, opName, stat);
    };

    container.appendChild(card);
  });
  
  container.style.display = "flex";
}

async function renderDetailCard(userNick, opponentNick, stat) {
  const detailCard = document.getElementById("detailCard");

  const matches = [...stat.matches].sort((a, b) => {
    const dateStrA = a.matches ? a.matches.match_date : (a.real_match_date || a.match_date);
    const dateStrB = b.matches ? b.matches.match_date : (b.real_match_date || b.match_date);
    return new Date(dateStrB || 0) - new Date(dateStrA || 0);
  });

  const totalMatches = matches.length;
  
  document.getElementById("detailTitle").innerText = `'${userNick}' vs '${opponentNick}'`;
  document.getElementById("matchCountBadge").innerText = `총 ${totalMatches}경기`;
  document.getElementById("winRateBadge").innerText = `승률 ${((stat.wins/totalMatches)*100).toFixed(1)}%`;

  // 최근 경기 칩
  const matchesContainer = document.getElementById("recentMatchesContainer");
  matchesContainer.innerHTML = "";

  matches.forEach(m => {
    const chip = document.createElement("div");
    let resultClass = "draw";
    if (m.match_result === "승") resultClass = "win";
    else if (m.match_result === "패") resultClass = "lose";

    chip.className = `match-chip ${resultClass}`;
    chip.innerText = `${m.match_result} (${m.goals_for}:${m.goals_against})`;
    matchesContainer.appendChild(chip);
  });

  // 💡 DB의 user_opponent_streaks 데이터 기반 모바일 대시보드 업데이트
  try {
    const { data: streakData } = await db
      .from('user_opponent_streaks')
      .select('*')
      .eq('ouid', currentSelectedUser.ouid)
      .eq('opponent_nick', opponentNick)
      .maybeSingle();

    if (streakData) {
      const badgeTexts = [];
      let badgeColorClass = "neutral";

      if (streakData.current_win_streak >= 2) {
        badgeTexts.push(`${streakData.current_win_streak}연승 중! 🔥`);
        badgeColorClass = "good";
      }
      if (streakData.current_lose_streak >= 2) {
        badgeTexts.push(`${streakData.current_lose_streak}연패 중... 😭`);
        badgeColorClass = "bad";
      }
      if (streakData.current_winless_streak >= 2 && streakData.current_winless_streak !== streakData.current_lose_streak) {
        badgeTexts.push(`${streakData.current_winless_streak}경기 연속 무승 중 ⚠️`);
        if (badgeColorClass === "neutral") badgeColorClass = "warning";
      }
      if (streakData.current_unbeaten_streak >= 2 && streakData.current_unbeaten_streak !== streakData.current_win_streak) {
        badgeTexts.push(`${streakData.current_unbeaten_streak}경기 연속 무패 중 🛡️`);
        if (badgeColorClass === "neutral") badgeColorClass = "good";
      }

      const streakEl = document.getElementById("streakBadge");
      streakEl.className = "streak-badge";
      if (badgeTexts.length > 0) {
        streakEl.innerText = badgeTexts.join(" / ");
        streakEl.classList.add(badgeColorClass);
      } else {
        streakEl.innerText = "진행 중인 특이 기록 없음";
        streakEl.classList.add("neutral");
      }

      // 🏆 2x2 대시보드 수치 대입
      document.getElementById("maxWinVal").innerText = `${streakData.max_win_streak}연승`;
      document.getElementById("maxLoseVal").innerText = `${streakData.max_lose_streak}연패`;
      document.getElementById("maxWinlessVal").innerText = `${streakData.max_winless_streak}경기`;
      document.getElementById("maxUnbeatenVal").innerText = `${streakData.max_unbeaten_streak}경기`;
    }
  } catch (err) {
    console.error("연속/최다 기록 불러오기 에러:", err);
  }

  // 선수 스탯 계산
  const goalMap = {}, assistMap = {}, saveMap = {}, appMap = {};

  matches.forEach(m => {
    const squad = m.player_squad || m.player_squid || [];
    squad.forEach(p => {
      if (p.spPosition === 28) return; 
      const spId = p.spId || p.spid;
      if (!spId || spId === 0) return;
      
      appMap[spId] = (appMap[spId] || 0) + 1;

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
  document.getElementById("avgGoals").innerText = `⚽ ${avgGoalsFor} / 🛡️ ${avgGoalsAgainst}`;
  document.getElementById("totalGoalsSub").innerText = `총 ${stat.goalsFor}득 / ${stat.goalsAgainst}실`;

  const setMetric = (nameId, detailId, topObj, unit) => {
    if (topObj.id && appMap[topObj.id]) {
      const appearances = appMap[topObj.id]; 
      document.getElementById(nameId).innerText = getPlayerName(topObj.id);
      document.getElementById(detailId).innerText = `${appearances}경기 ${topObj.count}${unit} (평균 ${(topObj.count / appearances).toFixed(2)})`;
    } else {
      document.getElementById(nameId).innerText = "기록 없음";
      document.getElementById(detailId).innerText = "-";
    }
  };

  setMetric("topScorerName", "topScorerDetail", topScorer, "골");
  setMetric("topAssisterName", "topAssisterDetail", topAssister, "도움");
  setMetric("topDefenderName", "topDefenderDetail", topSaver, "선방");

  detailCard.style.display = "block";
  detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.onload = fetchUsersAndInitButtons;
