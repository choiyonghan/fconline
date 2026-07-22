const SUPABASE_URL = "https://jwqhpdtizrpyohlrqfgu.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_aXnxmQfcuNVBYdbjyHf8xQ_RsJTeBIL"; 

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const WOOK_NICKNAMES = ["지린성에사는욱구", "욱냥0I"];
let spidMetaMap = {}; 

let currentSelectedUser = null;
let rawMatchDetails = []; 

// UTC 날짜 문자열을 KST Date 객체로 변환
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
  
  // 날짜 필터 버튼 클릭 이벤트 바인딩
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
    statusEl.innerText = `총 ${users.length}명의 유저를 불러왔습니다. 분석할 닉네임을 클릭하세요.`;
  } catch (err) {
    console.error("유저 로드 에러:", err);
  }
}

// 3. 닉네임 클릭 처리 (matches 테이블과 JOIN)
async function handleNicknameClick(userObj, btnElement) {
  const statusEl = document.getElementById("status");
  currentSelectedUser = userObj;
  
  document.querySelectorAll(".btn-nickname").forEach(b => b.classList.remove("active"));
  btnElement.classList.add("active");
  
  document.getElementById("opponentList").style.display = "none";
  document.getElementById("summaryInfo").style.display = "none";
  document.getElementById("detailCard").style.display = "none";
  document.getElementById("overallStatsContainer").innerHTML = "";
  
  document.getElementById("startDate").value = "";
  document.getElementById("endDate").value = "";
  
  statusEl.innerText = "데이터 분석 중...";

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
    statusEl.innerText = `분석 완료! 상대를 선택해 상세 전적을 확인하세요.`;
  } catch (err) {
    console.error("매치 데이터 로드 에러:", err);
    statusEl.innerText = "오류가 발생했습니다.";
  }
}

// 4. 날짜 필터링 적용
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

  statusEl.innerText = `필터 적용 완료 (${filteredMatches.length}경기 검색됨)`;
  processAndRenderMatches(filteredMatches);
}

// 5. 날짜 필터 초기화
function resetDateFilter() {
  document.getElementById("startDate").value = "";
  document.getElementById("endDate").value = "";
  if (rawMatchDetails && rawMatchDetails.length > 0) {
    document.getElementById("status").innerText = "전체 기간으로 다시 조회를 실행했습니다.";
    processAndRenderMatches(rawMatchDetails);
  }
}

// 6. 데이터 연산 및 화면 렌더링
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

// 7. 전체 종합 전적 렌더링
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
  const avgPoss = (posSum / totalMatches).toFixed(1);
  const avgShoot = (shootSum / totalMatches).toFixed(1);
  const avgEffShoot = (effShootSum / totalMatches).toFixed(1);

  const getTopPlayer = (map) => {
    let topId = null, maxVal = 0;
    for (const id in map) { if (map[id] > maxVal) { maxVal = map[id]; topId = id; } }
    return { id: topId, count: maxVal };
  };

  const topScorer = getTopPlayer(goalMap);
  const topAssister = getTopPlayer(assistMap);
  const topSaver = getTopPlayer(saveMap);

  const getTopText = (topObj, unit) => {
    if (!topObj.id || !appMap[topObj.id]) return `<span style="color:#888;">기록 없음</span>`;
    const apps = appMap[topObj.id];
    const name = getPlayerName(topObj.id);
    const avg = (topObj.count / apps).toFixed(2);
    return `<strong>${name}</strong> (${apps}경기 ${topObj.count}${unit} / 경기당 ${avg}${unit})`;
  };

  container.innerHTML = `
    <div class="op-card" style="margin-bottom: 25px; border: 2px solid #ffcc00; background-color: #fffdf5; cursor: default;">
      <div class="op-card-header">
        <div class="op-name">👑 '${userNick}' 종합 전적</div>
        <div class="op-winrate">총 승률 ${winRate}%</div>
      </div>
      <div class="op-card-stats" style="grid-template-columns: repeat(2, 1fr); gap: 15px;">
        <div class="op-stat-item">
          <div style="color:var(--text-muted)">총 ${totalMatches}전</div>
          <div class="op-stat-val"><span class="win-text">${wins}승</span> ${draws}무 <span class="lose-text">${losses}패</span></div>
        </div>
        <div class="op-stat-item">
          <div style="color:var(--text-muted)">평균 득/실점</div>
          <div class="op-stat-val">⚽ ${avgGoalsFor} / 🛡️ ${avgGoalsAgainst}</div>
        </div>
        <div class="op-stat-item">
          <div style="color:var(--text-muted)">평균 점유율</div>
          <div class="op-stat-val">${avgPoss}%</div>
        </div>
        <div class="op-stat-item">
          <div style="color:var(--text-muted)">유효/총 슈팅 (평균)</div>
          <div class="op-stat-val">${avgEffShoot} / ${avgShoot}</div>
        </div>
      </div>
      
      <hr style="border:0; border-top:1px dashed #ccc; margin: 15px 0;">
      
      <div class="op-card-stats" style="grid-template-columns: 1fr; gap: 8px; text-align: left; padding: 0 10px;">
        <div style="font-size: 0.95rem;">⚽ <span style="color:#666; margin-right:5px;">종합 최다 득점:</span> ${getTopText(topScorer, '골')}</div>
        <div style="font-size: 0.95rem;">👟 <span style="color:#666; margin-right:5px;">종합 최다 도움:</span> ${getTopText(topAssister, '도움')}</div>
        <div style="font-size: 0.95rem;">🧤 <span style="color:#666; margin-right:5px;">종합 최다 선방:</span> ${getTopText(topSaver, '선방')}</div>
      </div>
    </div>
  `;
}

// 8. 상대 카드 리스트 렌더링 (🪗 아코디언 토글)
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
      let wookScore, normalScore;
      let wookName = "", normalName = "";

      if (isSelectedWook) {
        wookName = selectedNickname;
        normalName = opName;
        wookScore = (stat.wins * 5) + (stat.draws * 3) + (stat.losses * 1);
        normalScore = (stat.losses * 3) + (stat.draws * 1);
      } else {
        wookName = opName;
        normalName = selectedNickname;
        wookScore = (stat.losses * 5) + (stat.draws * 3) + (stat.wins * 1);
        normalScore = (stat.wins * 3) + (stat.draws * 1);
      }

      let winnerText = wookScore > normalScore
        ? `${wookName} 승리! 🎉`
        : wookScore < normalScore
          ? `${normalName} 승리! 🎉`
          : "무승부 🤝";

      wookHtml = `
        <div class="wook-badge-box">
          🏆 욱식 점수: ${wookName} ${wookScore}점 vs ${normalName} ${normalScore}점<br>
          <strong>(${winnerText})</strong>
        </div>
      `;
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
  
  container.style.display = "grid";
}

// 9. 상대별 상세 분석 렌더링 (⚽ 가로 스크롤 경기 결과 추가)
function renderDetailCard(userNick, opponentNick, stat) {
  const detailCard = document.getElementById("detailCard");
  const matches = stat.matches;
  const totalMatches = matches.length;
  
  document.getElementById("detailTitle").innerText = `'${userNick}' vs '${opponentNick}'`;
  document.getElementById("matchCountBadge").innerText = `총 ${totalMatches}경기`;
  document.getElementById("winRateBadge").innerText = `승률 ${((stat.wins/totalMatches)*100).toFixed(1)}%`;

  // --- 🔥 [신규] 최근 경기 결과 가로 스크롤 렌더링 ---
  const scrollContainer = document.getElementById("recentMatchesScroll");
  if (scrollContainer) {
    scrollContainer.innerHTML = "";
    
    // matches 배열을 순회하며 가로 배지 생성 (최신순)
    matches.forEach((m) => {
      const res = m.match_result || "무";
      const gFor = m.goals_for !== undefined ? m.goals_for : 0;
      const gAgainst = m.goals_against !== undefined ? m.goals_against : 0;

      let typeClass = "draw";
      if (res === "승") typeClass = "win";
      else if (res === "패") typeClass = "loss";

      const chip = document.createElement("div");
      chip.className = `match-chip ${typeClass}`;
      chip.innerHTML = `
        <span>${res}</span>
        <span class="chip-score">${gFor}:${gAgainst}</span>
      `;
      scrollContainer.appendChild(chip);
    });
  }

  // 연승/연패 계산
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
  document.getElementById("avgGoals").innerText = `⚽ ${avgGoalsFor}골 / 🛡️ ${avgGoalsAgainst}실점`;
  document.getElementById("totalGoalsSub").innerText = `총 ${stat.goalsFor}득점 / 총 ${stat.goalsAgainst}실점`;

  const setMetric = (nameId, detailId, topObj, unit) => {
    if (topObj.id && appMap[topObj.id]) {
      const appearances = appMap[topObj.id]; 
      document.getElementById(nameId).innerText = getPlayerName(topObj.id);
      document.getElementById(detailId).innerText = `${appearances}경기 ${topObj.count}${unit} (평균 ${(topObj.count / appearances).toFixed(2)}${unit})`;
    } else {
      document.getElementById(nameId).innerText = "기록 없음";
      document.getElementById(detailId).innerText = "(직접 갱신한 전적 필요)";
    }
  };

  setMetric("topScorerName", "topScorerDetail", topScorer, "골");
  setMetric("topAssisterName", "topAssisterDetail", topAssister, "도움");
  setMetric("topDefenderName", "topDefenderDetail", topSaver, "선방");

  detailCard.style.display = "block";
  detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.onload = fetchUsersAndInitButtons;
