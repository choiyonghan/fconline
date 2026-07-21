const SUPABASE_URL = "https://jwqhpdtizrpyohlrqfgu.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_aXnxmQfcuNVBYdbjyHf8xQ_RsJTeBIL"; 

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const WOOK_NICKNAMES = ["지린성에사는욱구", "욱냥0I"];
const dbCache = {};

// 1. users 테이블 로드
async function fetchUsersAndInitButtons() {
  const statusEl = document.getElementById("status");
  const container = document.getElementById("nicknameButtons");

  try {
    const { data: users, error } = await db
      .from('users')
      .select('nickname, ouid')
      .order('nickname', { ascending: true });

    if (error) throw error;
    if (!users || users.length === 0) {
      statusEl.innerText = "❌ users 테이블에 등록된 닉네임이 없거나 RLS 설정 문제입니다.";
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

// 2. 닉네임 클릭 및 데이터 조회
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

// 3. 메인 테이블 생성
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

// 4. 클릭 시 상세 분석 지표 렌더링
function renderDetailCard(userNick, opponentNick, matches) {
  const detailCard = document.getElementById("detailCard");
  document.getElementById("detailTitle").innerText = `'${userNick}' vs '${opponentNick}' 맞대결 심층 지표 (${matches.length}경기)`;

  let playerMap = {};
  let totalShootsCount = 0;
  let inBoxShootsCount = 0;
  let throughPassTrySum = 0;
  let throughPassSuccessSum = 0;
  let tackleTrySum = 0;
  let tackleSuccessSum = 0;
  let foulSum = 0;

  matches.forEach(m => {
    const squad = m.player_squid || [];
    squad.forEach(p => {
      if (p.status && p.status.spRating > 0) {
        if (!playerMap[p.spId]) {
          playerMap[p.spId] = { spId: p.spId, ratingSum: 0, goals: 0, assists: 0, count: 0 };
        }
        playerMap[p.spId].ratingSum += p.status.spRating;
        playerMap[p.spId].goals += (p.status.goal || 0);
        playerMap[p.spId].assists += (p.status.assist || 0);
        playerMap[p.spId].count += 1;
      }
    });

    const shoots = m.shoot_detail || [];
    shoots.forEach(s => {
      totalShootsCount += 1;
      if (s.inPenalty) inBoxShootsCount += 1;
    });

    throughPassTrySum += (m.through_pass_try || 0);
    throughPassSuccessSum += (m.through_pass_success || 0);
    tackleTrySum += (m.tackle_try || 0);
    tackleSuccessSum += (m.tackle_success || 0);
    foulSum += (m.foul || 0);
  });

  const playerList = Object.values(playerMap);
  if (playerList.length > 0) {
    playerList.sort((a, b) => (b.ratingSum / b.count) - (a.ratingSum / a.count));
    const topPlayer = playerList[0];
    const avgRating = (topPlayer.ratingSum / topPlayer.count).toFixed(2);
    
    document.getElementById("momName").innerText = `선수 ID: ${topPlayer.spId}`;
    document.getElementById("momDetail").innerText = `평점: ${avgRating}점 | ${topPlayer.goals}골 ${topPlayer.assists}어시`;
  } else {
    document.getElementById("momName").innerText = "선수 데이터 없음";
    document.getElementById("momDetail").innerText = "-";
  }

  const boxRate = totalShootsCount > 0 ? ((inBoxShootsCount / totalShootsCount) * 100).toFixed(1) : "0.0";
  document.getElementById("boxShootRate").innerText = `${boxRate}%`;
  document.getElementById("shootSub").innerText = `총 ${totalShootsCount}회 중 박스 안 ${inBoxShootsCount}회`;

  const throughRate = throughPassTrySum > 0 ? ((throughPassSuccessSum / throughPassTrySum) * 100).toFixed(1) : "0.0";
  let styleText = "단거리 점유율 중심";
  if (throughPassTrySum / matches.length > 10) styleText = "침투 스루패스 위주";
  
  document.getElementById("passStyle").innerText = styleText;
  document.getElementById("throughPassRate").innerText = `스루패스 성공률: ${throughRate}% (${throughPassSuccessSum}/${throughPassTrySum})`;

  const tackleRate = tackleTrySum > 0 ? ((tackleSuccessSum / tackleTrySum) * 100).toFixed(1) : "0.0";
  const avgFoul = (foulSum / matches.length).toFixed(1);
  
  document.getElementById("tackleRate").innerText = `${tackleRate}%`;
  document.getElementById("foulDetail").innerText = `태클 성공 ${tackleSuccessSum}/${tackleTrySum}회 | 경기당 파울 ${avgFoul}회`;

  detailCard.style.display = "block";
  detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.onload = fetchUsersAndInitButtons;
