const SUPABASE_URL = "https://jwqhpdtizrpyohlrqfgu.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_aXnxmQfcuNVBYdbjyHf8xQ_RsJTeBIL"; 

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const WOOK_NICKNAMES = ["지린성에사는욱구", "욱냥0I"];
const dbCache = {};
let spidMetaMap = {}; 

// 1. 넥슨 Open API spid.json 메타데이터 로드
async function loadSpidMeta() {
  try {
    const res = await fetch("https://open.api.nexon.com/static/fconline/meta/spid.json");
    if (!res.ok) throw new Error("spid.json 로드 실패");
    const data = await res.json();

    data.forEach(item => {
      spidMetaMap[item.id] = item.name;
    });
    console.log(`선수 메타데이터 ${data.length}개 로드 완료!`);
  } catch (err) {
    console.error("SPID 메타데이터 가져오기 실패:", err);
  }
}

function getPlayerName(spId) {
  return spidMetaMap[spId] || `선수(ID:${spId})`;
}

// 2. users 테이블 로드 및 버튼 생성
async function fetchUsersAndInitButtons() {
  const statusEl = document.getElementById("status");
  const container = document.getElementById("nicknameButtons");

  await loadSpidMeta();

  try {
    const { data: users, error } = await db
      .from('users')
      .select('nickname, ouid')
      .order('nickname', { ascending: true });

    if (error) throw error;
    if (!users || users.length === 0) {
      statusEl.innerText = "❌ users 테이블에 등록된 닉네임이 없습니다.";
      return;
    }

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
    statusEl.innerText = "❌ users 테이블을 불러오지 못했습니다.";
  }
}

// 3. 닉네임 클릭 및 DB 조회
async function handleNicknameClick(userObj, btnElement) {
  const statusEl = document.getElementById("status");
  const selectedNickname = userObj.nickname;
  const userOuid = userObj.ouid;

  document.querySelectorAll(".btn-nickname").forEach(b => b.classList.remove("active"));
  btnElement.classList.add("active");

  document.getElementById("tableContainer").style.display = "none";
  document.getElementById("detailCard").style.display = "none";
  statusEl.innerText = `'${selectedNickname}' 님의 전적 데이터를 조회 중입니다...`;

  try {
    const { data: matchDetails, error } = await db
      .from('match_details')
      .select('*')
      .eq('ouid', userOuid)
      .order('id', { ascending: false });

    if (error) throw error;
    if (!matchDetails || matchDetails.length === 0) {
      statusEl.innerText = `'${selectedNickname}' 님의 매치 상세 데이터가 없습니다.`;
      return;
    }

    const opponentGroup = {};
    matchDetails.forEach(detail => {
      const opponentNickname = detail.opponent_nick || "상대 미상";

      if (!opponentGroup[opponentNickname]) {
        opponentGroup[opponentNickname] = {
          total: 0, wins: 0, draws: 0, losses: 0,
          goalsFor: 0, goalsAgainst: 0, possessionSum: 0,
          shootTotalSum: 0, effectiveShootSum: 0,
          matches: []
        };
      }

      const group = opponentGroup[opponentNickname];
      group.total += 1;
      if (detail.match_result === "승") group.wins += 1;
      else if (detail.match_result === "무") group.draws += 1;
      else if (detail.match_result === "패") group.losses += 1;

      group.goalsFor += (detail.goals_for || 0);
      group.goalsAgainst += (detail.goals_against || 0);
      group.possessionSum += (detail.possession || 0);
      group.shootTotalSum += (detail.shoot_total || 0);
      group.effectiveShootSum += (detail.effective_shoot || 0);
      group.matches.push(detail);
    });

    dbCache[selectedNickname] = { opponentGroup };
    renderGroupedTable(selectedNickname, opponentGroup);
    statusEl.innerText = `'${selectedNickname}' 님의 최근 ${matchDetails.length}경기 분석 완료! (행을 클릭해 상세 지표를 보세요)`;

  } catch (err) {
    console.error("매치 데이터 로드 에러:", err);
    statusEl.innerText = "데이터 조회 중 에러가 발생했습니다.";
  }
}

// 4. 메인 전적 테이블 렌더링
function renderGroupedTable(selectedNickname, opponentGroup) {
  const tableBody = document.getElementById("resultTableBody");
  tableBody.innerHTML = "";

  const isSelectedWook = WOOK_NICKNAMES.includes(selectedNickname);
  const sortedOpponents = Object.keys(opponentGroup).sort((a, b) => opponentGroup[b].total - opponentGroup[a].total);

  sortedOpponents.forEach((opName, idx) => {
    const stat = opponentGroup[opName];
    const winRate = stat.total > 0 ? ((stat.wins / stat.total) * 100).toFixed(1) : "0.0";
    const avgPossession = stat.total > 0 ? (stat.possessionSum / stat.total).toFixed(1) : "0";
    const avgEffectiveShoot = stat.total > 0 ? (stat.effectiveShootSum / stat.total).toFixed(1) : "0";
    const avgTotalShoot = stat.total > 0 ? (stat.shootTotalSum / stat.total).toFixed(1) : "0";

    const isOpponentWook = WOOK_NICKNAMES.includes(opName);
    const hasWookCalc = isSelectedWook || isOpponentWook;

    let wookHtml = "<span style='color:#94a3b8;'>-</span>";
    if (hasWookCalc) {
      let wookWins = isSelectedWook ? stat.wins : stat.losses;
      let wookDraws = stat.draws;
      let wookLosses = isSelectedWook ? stat.losses : stat.wins;
      let opponentLabel = isSelectedWook ? opName : selectedNickname;

      const swScore = (wookWins * 5) + (wookDraws * 3) + (wookLosses * 1);
      const opScore = (wookLosses * 3) + (wookDraws * 1) + (wookWins * 0);

      let winnerText = "🤝 무승부";
      if (swScore > opScore) winnerText = isSelectedWook ? "🥇 승욱 승리!" : `🥇 승욱(${opName}) 승리!`;
      else if (swScore < opScore) winnerText = `🏅 ${opponentLabel} 승리!`;

      wookHtml = `
        <div style="font-size:12px; text-align:left;">
          <b>승욱</b>: ${swScore}점 | <b>${opponentLabel}</b>: ${opScore}점<br>
          <span style="font-weight:bold; color:#b45309;">${winnerText}</span>
        </div>
      `;
    }

    const row = document.createElement("tr");
    row.id = `row-${idx}`;
    if (hasWookCalc) row.className = "wook-row";
    
    row.innerHTML = `
      <td class="opponent-cell">${opName}${hasWookCalc ? '<span class="wook-badge">욱식</span>' : ''}</td>
      <td><strong>${stat.total}</strong></td>
      <td><span class="win-text">${stat.wins}승</span> <span class="draw-text">${stat.draws}무</span> <span class="lose-text">${stat.losses}패</span></td>
      <td>${winRate}%</td>
      <td>${stat.goalsFor}/${stat.goalsAgainst}</td>
      <td>${avgPossession}%</td>
      <td>${avgEffectiveShoot} / ${avgTotalShoot}개</td>
      <td>${wookHtml}</td>
    `;

    row.onclick = () => {
      document.querySelectorAll("tbody tr").forEach(r => r.classList.remove("selected-row"));
      row.classList.add("selected-row");
      renderDetailCard(selectedNickname, opName, stat.matches);
    };

    tableBody.appendChild(row);
  });

  document.getElementById("tableContainer").style.display = "block";
}

// 5. ROW 클릭 시 심층 지표 (평균 득/실 및 Top3 선수) 연산
function renderDetailCard(userNick, opponentNick, matches) {
  const detailCard = document.getElementById("detailCard");
  const totalMatches = matches.length;
  
  document.getElementById("detailTitle").innerText = `'${userNick}' vs '${opponentNick}' 맞대결 분석 (${totalMatches}경기)`;

  let totalGoalsFor = 0;
  let totalGoalsAgainst = 0;
  const playerStats = {};

  matches.forEach(m => {
    totalGoalsFor += (m.goals_for || 0);
    totalGoalsAgainst += (m.goals_against || 0);

    // player_squad 또는 player_squid 대응
    const squad = m.player_squad || m.player_squid || [];

    squad.forEach(p => {
      const spId = p.spId || p.spid;
      if (!spId || spId === 0) return;

      if (!playerStats[spId]) {
        playerStats[spId] = { spId: spId, goal: 0, assist: 0, defense: 0 };
      }

      // status 안쪽/겉쪽 스탯 파싱 안전처리
      const st = p.status || p;

      const goalCount = st.goal || st.goals || 0;
      const assistCount = st.assist || st.assists || 0;

      let defenseCount = 0;
      if (st.defending !== undefined) {
        defenseCount = st.defending;
      } else {
        const tackle = st.tackle || st.tackleSuccess || 0;
        const intercept = st.intercept || 0;
        const block = st.block || 0;
        defenseCount = tackle + intercept + block;
      }

      playerStats[spId].goal += Number(goalCount);
      playerStats[spId].assist += Number(assistCount);
      playerStats[spId].defense += Number(defenseCount);
    });
  });

  // 1) 평균 득/실 계산
  const avgGoalsFor = (totalGoalsFor / totalMatches).toFixed(2);
  const avgGoalsAgainst = (totalGoalsAgainst / totalMatches).toFixed(2);

  document.getElementById("avgGoals").innerText = `⚽ ${avgGoalsFor}골 / 🛡️ ${avgGoalsAgainst}실점`;
  document.getElementById("totalGoalsSub").innerText = `총 ${totalGoalsFor}득점 / 총 ${totalGoalsAgainst}실점`;

  // 2) Top 선수 추출
  const players = Object.values(playerStats);

  if (players.length > 0) {
    // 최다 득점
    players.sort((a, b) => b.goal - a.goal);
    const topScorer = players[0];
    if (topScorer.goal > 0) {
      const avgScorerGoals = (topScorer.goal / totalMatches).toFixed(2);
      document.getElementById("topScorerName").innerText = getPlayerName(topScorer.spId);
      document.getElementById("topScorerDetail").innerText = `총 ${topScorer.goal}골 (경기당 ${avgScorerGoals}골)`;
    } else {
      document.getElementById("topScorerName").innerText = "득점 선수 없음";
      document.getElementById("topScorerDetail").innerText = "-";
    }

    // 최다 어시스트
    players.sort((a, b) => b.assist - a.assist);
    const topAssister = players[0];
    if (topAssister.assist > 0) {
      const avgAssisterAssists = (topAssister.assist / totalMatches).toFixed(2);
      document.getElementById("topAssisterName").innerText = getPlayerName(topAssister.spId);
      document.getElementById("topAssisterDetail").innerText = `총 ${topAssister.assist}어시스트 (경기당 ${avgAssisterAssists}개)`;
    } else {
      document.getElementById("topAssisterName").innerText = "어시스트 선수 없음";
      document.getElementById("topAssisterDetail").innerText = "-";
    }

    // 최다 수비 성공
    players.sort((a, b) => b.defense - a.defense);
    const topDefender = players[0];
    if (topDefender.defense > 0) {
      document.getElementById("topDefenderName").innerText = getPlayerName(topDefender.spId);
      document.getElementById("topDefenderDetail").innerText = `총 ${topDefender.defense}회 수비 성공`;
    } else {
      document.getElementById("topDefenderName").innerText = "수비 기록 없음";
      document.getElementById("topDefenderDetail").innerText = "-";
    }

  } else {
    document.getElementById("topScorerName").innerText = "스쿼드 데이터 없음";
    document.getElementById("topAssisterName").innerText = "스쿼드 데이터 없음";
    document.getElementById("topDefenderName").innerText = "스쿼드 데이터 없음";
  }

  detailCard.style.display = "block";
  detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.onload = fetchUsersAndInitButtons;
