const SUPABASE_URL = "https://jwqhpdtizrpyohlrqfgu.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_aXnxmQfcuNVBYdbjyHf8xQ_RsJTeBIL"; 

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const WOOK_NICKNAMES = ["지린성에사는욱구", "욱냥0I"];
let spidMetaMap = {}; 

let currentSelectedUser = null;
let currentMatchType = "custom"; // DEFAULT: 커스텀 매치 ('custom' | 'official')
let rawMatchDetails = []; 
let streakDataMap = {}; // user_opponent_streaks DB 데이터 저장용

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

// TOP 3 목록 생성 도움 함수
function getTop3Players(map, appMap, unit) {
  const sorted = Object.keys(map)
    .map(id => ({ id, count: map[id], apps: appMap[id] || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  if (sorted.length === 0) return `<div style="color:#888;">기록 없음</div>`;

  return sorted.map((p, idx) => {
    const name = getPlayerName(p.id);
    const avg = p.apps > 0 ? (p.count / p.apps).toFixed(2) : 0;
    return `
      <div class="top-player-item">
        <span class="top-player-name">${idx + 1}. ${name}</span>
        <span class="top-player-stat">${p.apps}경기 ${p.count}${unit} (평균 ${avg})</span>
      </div>
    `;
  }).join('');
}

// 연속 무패 / 무승 시의 세부 [승/무/패] 성적 연산 도움 함수
function computeStreakDetails(matches) {
  let maxUnbeaten = 0, maxUnbeatenDetail = "0승 0무";
  let maxWinless = 0, maxWinlessDetail = "0무 0패";

  let curUnbeaten = 0, curUnbeatenW = 0, curUnbeatenD = 0;
  let curWinless = 0, curWinlessD = 0, curWinlessL = 0;

  // 오래된 경기부터 순회하며 연속 연승/무패 계산
  const sortedAsc = [...matches].sort((a, b) => {
    const dA = new Date(a.real_match_date || 0);
    const dB = new Date(b.real_match_date || 0);
    return dA - dB;
  });

  sortedAsc.forEach(m => {
    const res = m.match_result;

    // 무패 (승 또는 무)
    if (res === '승' || res === '무') {
      curUnbeaten++;
      if (res === '승') curUnbeatenW++;
      if (res === '무') curUnbeatenD++;
      if (curUnbeaten > maxUnbeaten) {
        maxUnbeaten = curUnbeaten;
        maxUnbeatenDetail = `${curUnbeatenW}승 ${curUnbeatenD}무`;
      }
    } else {
      curUnbeaten = 0; curUnbeatenW = 0; curUnbeatenD = 0;
    }

    // 무승 (무 또는 패)
    if (res === '무' || res === '패') {
      curWinless++;
      if (res === '무') curWinlessD++;
      if (res === '패') curWinlessL++;
      if (curWinless > maxWinless) {
        maxWinless = curWinless;
        maxWinlessDetail = `${curWinlessD}무 ${curWinlessL}패`;
      }
    } else {
      curWinless = 0; curWinlessD = 0; curWinlessL = 0;
    }
  });

  return { maxUnbeaten, maxUnbeatenDetail, maxWinless, maxWinlessDetail };
}

// 2. 초기화 및 이벤트 리스너
async function fetchUsersAndInitButtons() {
  const statusEl = document.getElementById("status");
  const container = document.getElementById("nicknameButtons");
  await loadSpidMeta();
  
  document.getElementById("btnSearchDate").addEventListener("click", applyDateFilter);
  document.getElementById("btnResetDate").addEventListener("click", resetDateFilter);

  // 매치 타입 선택 버튼 이벤트 등록
  const btnCustom = document.getElementById("btnMatchTypeCustom");
  const btnOfficial = document.getElementById("btnMatchTypeOfficial");

  btnCustom.addEventListener("click", () => handleMatchTypeChange("custom"));
  btnOfficial.addEventListener("click", () => handleMatchTypeChange("official"));

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

// 매치 타입 변경 핸들러
function handleMatchTypeChange(type) {
  if (currentMatchType === type) return;
  currentMatchType = type;

  document.getElementById("btnMatchTypeCustom").classList.toggle("active", type === "custom");
  document.getElementById("btnMatchTypeOfficial").classList.toggle("active", type === "official");

  if (currentSelectedUser) {
    loadUserMatchData(currentSelectedUser);
  }
}

// 3. 닉네임 클릭 처리
async function handleNicknameClick(userObj, btnElement) {
  currentSelectedUser = userObj;
  
  document.querySelectorAll(".btn-nickname").forEach(b => b.classList.remove("active"));
  btnElement.classList.add("active");

  loadUserMatchData(userObj);
}

// 유저 매치 데이터 로드
async function loadUserMatchData(userObj) {
  const statusEl = document.getElementById("status");
  
  // 아코디언 DOM 위치 보존
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
  
  const typeText = currentMatchType === "custom" ? "커스텀 매치" : "공식 경기";
  statusEl.innerText = `[${typeText}] 데이터 계산 중...`;

  try {
    let matchQuery = db.from('match_details')
      .select('*, matches(match_date)')
      .eq('ouid', userObj.ouid);

    if (currentMatchType === "custom") {
      matchQuery = matchQuery.or('match_type.eq.50,match_type.eq.custom,match_type.is.null');
    } else {
      matchQuery = matchQuery.or('match_type.eq.52,match_type.eq.60,match_type.eq.official');
    }

    matchQuery = matchQuery.order('id', { ascending: false });

    const [matchRes, streakRes] = await Promise.all([
      matchQuery,
      db.from('user_opponent_streaks')
        .select('*')
        .eq('ouid', userObj.ouid)
    ]);

    if (matchRes.error) throw matchRes.error;

    streakDataMap = {};
    if (streakRes.data) {
      streakRes.data.forEach(item => {
        const key = item.opponent_nick || item.opponent_ouid;
        if (key) streakDataMap[key] = item;
      });
    }

    const matchDetails = matchRes.data;
    if (!matchDetails || matchDetails.length === 0) {
      statusEl.innerText = `[${typeText}] 전적 데이터가 없습니다.`;
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
    statusEl.innerText = `[${typeText}] 분석 완료! 상대를 선택해 상세 전적을 확인하세요.`;
  } catch (err) {
    console.error("매치 데이터 로드 에러:", err);
    statusEl.innerText = "데이터 조회 중 오류가 발생했습니다.";
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

  statusEl.innerText = `필터 적용 (${filteredMatches.length}경기)`;
  processAndRenderMatches(filteredMatches);
}

// 5. 날짜 필터 초기화
function resetDateFilter() {
  document.getElementById("startDate").value = "";
  document.getElementById("endDate").value = "";
  if (rawMatchDetails && rawMatchDetails.length > 0) {
    document.getElementById("status").innerText = "전체 기간으로 조회를 다시 실행했습니다.";
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

  const topScorersHtml = getTop3Players(goalMap, appMap, "골");
  const topAssistersHtml = getTop3Players(assistMap, appMap, "도움");
  const topSaversHtml = getTop3Players(saveMap, appMap, "선방");

  container.innerHTML = `
    <div class="card" style="border: 2px solid #f59e0b; background-color: #fffdf5;">
      <div class="op-card-header">
        <div class="op-name">👑 '${userNick}' 종합 전적</div>
        <div class="op-winrate">승률 ${winRate}%</div>
      </div>
      <div class="op-card-stats" style="grid-template-columns: repeat(2, 1fr); gap: 6px;">
        <div>
          <div style="color:var(--text-muted)">총 ${totalMatches}전</div>
          <div class="op-stat-val"><span class="win-text">${wins}승</span> ${draws}무 <span class="lose-text">${losses}패</span></div>
        </div>
        <div>
          <div style="color:var(--text-muted)">평균 득/실점</div>
          <div class="op-stat-val">⚽ ${avgGoalsFor} / 🛡️ ${avgGoalsAgainst}</div>
        </div>
        <div>
          <div style="color:var(--text-muted)">평균 점유율</div>
          <div class="op-stat-val">${avgPoss}%</div>
        </div>
        <div>
          <div style="color:var(--text-muted)">유효/총 슈팅</div>
          <div class="op-stat-val">${avgEffShoot} / ${avgShoot}</div>
        </div>
      </div>
      
      <hr style="border:0; border-top:1px dashed #cbd5e1; margin: 10px 0;">
      
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div>
          <div style="font-weight:700; font-size:0.8rem; color:#334155; margin-bottom:2px;">⚽ 최다 득점 TOP 3</div>
          ${topScorersHtml}
        </div>
        <div>
          <div style="font-weight:700; font-size:0.8rem; color:#334155; margin-bottom:2px;">👟 최다 도움 TOP 3</div>
          ${topAssistersHtml}
        </div>
        <div>
          <div style="font-weight:700; font-size:0.8rem; color:#334155; margin-bottom:2px;">🧤 최다 선방 TOP 3</div>
          ${topSaversHtml}
        </div>
      </div>
    </div>
  `;
}

// 8. 상대 카드 리스트 (서머리 UI) 렌더링 (⭐ 서머리 간소화 반영)
function renderOpponentCards(selectedNickname, opponentGroup) {
  const container = document.getElementById("opponentList");
  container.innerHTML = "";
  
  const isSelectedWook = WOOK_NICKNAMES.includes(selectedNickname);
  const sortedOpponents = Object.keys(opponentGroup).sort((a, b) => opponentGroup[b].total - opponentGroup[a].total);

  sortedOpponents.forEach((opName) => {
    const stat = opponentGroup[opName];
    const total = stat.total;
    const winRate = ((stat.wins/total)*100).toFixed(1);

    const dbStreak = streakDataMap[opName] || {};
    const maxWin = dbStreak.max_win_streak ?? 0;
    const maxLose = dbStreak.max_lose_streak ?? 0;

    const { maxUnbeaten, maxUnbeatenDetail, maxWinless, maxWinlessDetail } = computeStreakDetails(stat.matches);

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

      <!-- 서머리 전적 (평균 득실점 및 점유율 제거로 가독성 향상) -->
      <div class="op-card-stats" style="grid-template-columns: 1fr;">
        <div>
          <div style="color:var(--text-muted); font-size:0.75rem;">상대 전적</div>
          <div class="op-stat-val" style="font-size: 1.05rem;"><span class="win-text">${stat.wins}승</span> ${stat.draws}무 <span class="lose-text">${stat.losses}패</span> (총 ${total}전)</div>
        </div>
      </div>

      <!-- 서머리 UI 통산 최다 연속 기록 칩 -->
      <div class="op-streak-summary">
        <div class="streak-item">
          <span class="streak-label">🔥 최다 연승</span>
          <span class="streak-val win-text">${maxWin}연승</span>
        </div>
        <div class="streak-item">
          <span class="streak-label">😭 최다 연패</span>
          <span class="streak-val lose-text">${maxLose}연패</span>
        </div>
        <div class="streak-item">
          <span class="streak-label">🛡️ 최다 무패</span>
          <span class="streak-val" style="color:#1d4ed8;">${maxUnbeaten}경기 (${maxUnbeatenDetail})</span>
        </div>
        <div class="streak-item">
          <span class="streak-label">⚠️ 최다 무승</span>
          <span class="streak-val" style="color:#b45309;">${maxWinless}경기 (${maxWinlessDetail})</span>
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
  
  container.style.display = "flex";
}

// 9. 상대별 상세 분석 렌더링 (⭐ 평균 점유율 카드 추가)
function renderDetailCard(userNick, opponentNick, stat) {
  const detailCard = document.getElementById("detailCard");

  const matches = [...stat.matches].sort((a, b) => {
    const dateStrA = a.matches ? a.matches.match_date : (a.real_match_date || a.match_date);
    const dateStrB = b.matches ? b.matches.match_date : (b.real_match_date || b.match_date);

    return new Date(dateStrB || 0).getTime() - new Date(dateStrA || 0).getTime();
  });

  const totalMatches = matches.length;
  
  document.getElementById("detailTitle").innerText = `'${userNick}' vs '${opponentNick}'`;
  document.getElementById("matchCountBadge").innerText = `총 ${totalMatches}경기`;
  document.getElementById("winRateBadge").innerText = `승률 ${((stat.wins/totalMatches)*100).toFixed(1)}%`;

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

  let winS = 0, loseS = 0;
  let winlessS = 0, winlessD = 0, winlessL = 0;
  let unbeatenS = 0, unbeatenW = 0, unbeatenD = 0;

  for (let m of matches) { if (m.match_result === '승') winS++; else break; }
  for (let m of matches) { if (m.match_result === '패') loseS++; else break; }
  
  for (let m of matches) {
    if (m.match_result !== '승') {
      winlessS++;
      if (m.match_result === '무') winlessD++;
      if (m.match_result === '패') winlessL++;
    } else break;
  }
  
  for (let m of matches) {
    if (m.match_result !== '패') {
      unbeatenS++;
      if (m.match_result === '승') unbeatenW++;
      if (m.match_result === '무') unbeatenD++;
    } else break;
  }

  let streakEl = document.getElementById("streakBadge");
  streakEl.className = "streak-badge"; 

  const badgeTexts = [];
  let badgeColorClass = "neutral";

  if (winS >= 2) { badgeTexts.push(`${winS}연승 중! 🔥`); badgeColorClass = "good"; }
  if (loseS >= 2) { badgeTexts.push(`${loseS}연패 중... 😭`); badgeColorClass = "bad"; }
  if (winlessS >= 2 && winlessS !== loseS) {
    badgeTexts.push(`${winlessS}경기 연속 무승 중 (${winlessD}무 ${winlessL}패) ⚠️`);
    if (badgeColorClass === "neutral") badgeColorClass = "warning";
  }
  if (unbeatenS >= 2 && unbeatenS !== winS) {
    badgeTexts.push(`${unbeatenS}경기 연속 무패 중 (${unbeatenW}승 ${unbeatenD}무) 🛡️`);
    if (badgeColorClass === "neutral") badgeColorClass = "good";
  }

  if (badgeTexts.length > 0) {
    streakEl.innerText = badgeTexts.join(" / ");
    streakEl.classList.add(badgeColorClass);
  } else {
    streakEl.innerText = "연승/연패 없음";
    streakEl.classList.add("neutral");
  }

  // 슈팅 / 유효 슈팅
  const avgShoots = (stat.shootSum / totalMatches).toFixed(1);
  const avgEffShoots = (stat.effShootSum / totalMatches).toFixed(1);
  const effRatio = stat.shootSum > 0 ? ((stat.effShootSum / stat.shootSum) * 100).toFixed(1) : 0;

  document.getElementById("avgShootsVal").innerText = `🎯 ${avgEffShoots} / ${avgShoots}회`;
  document.getElementById("effShootRatioSub").innerText = `유효슈팅 비율: ${effRatio}% (총 ${stat.effShootSum}회)`;

  // 평균 득실점
  const avgGoalsFor = (stat.goalsFor / totalMatches).toFixed(1);
  const avgGoalsAgainst = (stat.goalsAgainst / totalMatches).toFixed(1);
  document.getElementById("avgGoals").innerText = `⚽ ${avgGoalsFor} / 🛡️ ${avgGoalsAgainst}`;
  document.getElementById("totalGoalsSub").innerText = `총 ${stat.goalsFor}득 / ${stat.goalsAgainst}실`;

  // 평균 점유율 (상세 영역으로 이동)
  const avgPoss = (stat.posSum / totalMatches).toFixed(1);
  const avgPossEl = document.getElementById("avgPossessionVal");
  if (avgPossEl) {
    avgPossEl.innerText = `📊 ${avgPoss}%`;
  }

  // --- 선수별 스탯 TOP 3 집계 ---
  const goalMap = {}, assistMap = {}, saveMap = {}, defensiveCoreMap = {}, appMap = {};

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

      const t = Number(st.tackle || 0);
      const ic = Number(st.intercept || 0);
      const bl = Number(st.block || 0);
      const defScore = t + ic + bl;
      if (defScore > 0) defensiveCoreMap[spId] = (defensiveCoreMap[spId] || 0) + defScore;
    });
  });

  document.getElementById("topScorerList").innerHTML = getTop3Players(goalMap, appMap, "골");
  document.getElementById("topAssisterList").innerHTML = getTop3Players(assistMap, appMap, "도움");
  document.getElementById("topDefenderList").innerHTML = getTop3Players(saveMap, appMap, "선방");
  document.getElementById("topDefensiveCoreList").innerHTML = getTop3Players(defensiveCoreMap, appMap, "회 차단");

  detailCard.style.display = "block";
  detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.onload = fetchUsersAndInitButtons;
