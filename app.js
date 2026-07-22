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
    data.forEach(item => { spidMetaMap[item.id] = item.name; });
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

// 3. 닉네임 클릭 및 DB 조회
async function handleNicknameClick(userObj, btnElement) {
  const statusEl = document.getElementById("status");
  const selectedNickname = userObj.nickname;
  const userOuid = userObj.ouid;

  document.querySelectorAll(".btn-nickname").forEach(b => b.classList.remove("active"));
  btnElement.classList.add("active");
  document.getElementById("tableContainer").style.display = "none";
  document.getElementById("detailCard").style.display = "none";

  try {
    const { data: matchDetails, error } = await db.from('match_details').select('*').eq('ouid', userOuid).order('id', { ascending: false });
    if (error) throw error;

    const opponentGroup = {};
    matchDetails.forEach(detail => {
      const opponentNickname = detail.opponent_nick || "상대 미상";
      if (!opponentGroup[opponentNickname]) {
        opponentGroup[opponentNickname] = { total: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, possessionSum: 0, shootTotalSum: 0, effectiveShootSum: 0, matches: [] };
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
    renderGroupedTable(selectedNickname, opponentGroup);
  } catch (err) {
    console.error("매치 데이터 로드 에러:", err);
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
    const row = document.createElement("tr");
    row.innerHTML = `<td>${opName}</td><td>${stat.total}</td><td>${stat.wins}승 ${stat.draws}무 ${stat.losses}패</td><td>${((stat.wins/stat.total)*100).toFixed(1)}%</td><td>${stat.goalsFor}/${stat.goalsAgainst}</td>`;
    row.onclick = () => renderDetailCard(selectedNickname, opName, stat.matches);
    tableBody.appendChild(row);
  });
  document.getElementById("tableContainer").style.display = "block";
}

// 5. 부문별 1등 자동 산출 로직
function renderDetailCard(userNick, opponentNick, matches) {
  const detailCard = document.getElementById("detailCard");
  document.getElementById("detailTitle").innerText = `'${userNick}' vs '${opponentNick}' 맞대결 분석`;

  const goalMap = {}, assistMap = {}, defenseMap = {};

  matches.forEach(m => {
    const squad = m.player_squad || m.player_squid || [];
    squad.forEach(p => {
      if (p.spPosition === 28) return; // 교체 선수 제외
      const spId = p.spId || p.spid;
      if (!spId || spId === 0) return;
      const st = p.status || p;

      // 기록이 있는 선수만 맵에 합산
      const g = Number(st.goal || 0);
      if (g > 0) goalMap[spId] = (goalMap[spId] || 0) + g;

      const a = Number(st.assist || 0);
      if (a > 0) assistMap[spId] = (assistMap[spId] || 0) + a;

      const d = Number(st.defending || 0) > 0 ? Number(st.defending) : (Number(st.tackle || 0) + Number(st.intercept || 0) + Number(st.block || 0));
      if (d > 0) defenseMap[spId] = (defenseMap[spId] || 0) + d;
    });
  });

  const getTopPlayer = (map) => {
    let topId = null, maxVal = 0;
    for (const id in map) { if (map[id] > maxVal) { maxVal = map[id]; topId = id; } }
    return { id: topId, count: maxVal };
  };

  const topScorer = getTopPlayer(goalMap);
  const topAssister = getTopPlayer(assistMap);
  const topDefender = getTopPlayer(defenseMap);

  document.getElementById("topScorerName").innerText = topScorer.id ? getPlayerName(topScorer.id) : "기록 없음";
  document.getElementById("topScorerDetail").innerText = topScorer.id ? `총 ${topScorer.count}골` : "-";
  document.getElementById("topAssisterName").innerText = topAssister.id ? getPlayerName(topAssister.id) : "기록 없음";
  document.getElementById("topAssisterDetail").innerText = topAssister.id ? `총 ${topAssister.count}어시스트` : "-";
  document.getElementById("topDefenderName").innerText = topDefender.id ? getPlayerName(topDefender.id) : "기록 없음";
  document.getElementById("topDefenderDetail").innerText = topDefender.id ? `총 ${topDefender.count}회 수비` : "-";

  detailCard.style.display = "block";
}

window.onload = fetchUsersAndInitButtons;
