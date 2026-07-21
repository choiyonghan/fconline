const fs = require('fs');

const NEXON_API_KEYS = [
  "test_7ef1de8b64f76f75c505bc5ff4a09ade1511e2129a0e67a3e068d4e220c828faefe8d04e6d233bd35cf2fabdeb93fb0d",
  "test_7ef1de8b64f76f75c505bc5ff4a09adec77ef45654b031ad16ce4d4f623e5f57efe8d04e6d233bd35cf2fabdeb93fb0d",
  "test_7ef1de8b64f76f75c505bc5ff4a09ade2b938a6649deba00303f77b12079511defe8d04e6d233bd35cf2fabdeb93fb0d"
];

let currentKeyIndex = 0;

const NICKNAMES = [
  "내혀를가져가",
  "지린성에사는욱구",
  "욱냥0I",
  "서울쥐",
  "아기블루스",
  "ST반니스텔로이",
  "프란체스co토티"
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchNexonApi(url) {
  while (currentKeyIndex < NEXON_API_KEYS.length) {
    const apiKey = NEXON_API_KEYS[currentKeyIndex];
    const response = await fetch(url, { headers: { "x-nxopen-api-key": apiKey } });

    if (response.status === 429) {
      console.warn(`[429 에러] ${currentKeyIndex + 1}번 API 키 제한. 다음 키로 교체.`);
      currentKeyIndex++;
      await sleep(200);
      continue;
    }

    if (!response.ok) throw new Error(`API 오류: ${response.status}`);
    return await response.json();
  }
  throw new Error("모든 API 키 제한 초과");
}

async function build() {
  const result = {
    updatedAt: new Date().toISOString(),
    users: {}
  };

  for (const nickname of NICKNAMES) {
    console.log(`[수집 시작] ${nickname}`);
    try {
      const userData = await fetchNexonApi(`https://open.api.nexon.com/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`);
      const matchIds = await fetchNexonApi(`https://open.api.nexon.com/fconline/v1/user/match?ouid=${userData.ouid}&matchtype=40&offset=0&limit=100`);

      const opponentGroup = {};

      for (const matchId of matchIds) {
        try {
          const detail = await fetchNexonApi(`https://open.api.nexon.com/fconline/v1/match-detail?matchid=${matchId}`);
          if (!detail || !detail.matchInfo) continue;

          const myInfo = detail.matchInfo.find(i => i.ouid === userData.ouid);
          const opInfo = detail.matchInfo.find(i => i.ouid !== userData.ouid);
          const opName = opInfo ? opInfo.nickname : "상대 미상";

          if (!opponentGroup[opName]) {
            opponentGroup[opName] = {
              total: 0, wins: 0, draws: 0, losses: 0,
              goalsFor: 0, goalsAgainst: 0,
              possessionSum: 0, shootTotalSum: 0, effectiveShootSum: 0,
              passTrySum: 0, passSuccessSum: 0
            };
          }

          const group = opponentGroup[opName];
          group.total += 1;

          if (myInfo) {
            if (myInfo.matchDetail) {
              if (myInfo.matchDetail.matchResult === "승") group.wins++;
              else if (myInfo.matchDetail.matchResult === "무") group.draws++;
              else if (myInfo.matchDetail.matchResult === "패") group.losses++;
              group.possessionSum += (myInfo.matchDetail.possession || 0);
            }
            if (myInfo.shoot) {
              group.goalsFor += (myInfo.shoot.goalTotal || 0);
              group.shootTotalSum += (myInfo.shoot.shootTotal || 0);
              group.effectiveShootSum += (myInfo.shoot.effectiveShootTotal || 0);
            }
            if (opInfo && opInfo.shoot) {
              group.goalsAgainst += (opInfo.shoot.goalTotal || 0);
            }
            if (myInfo.pass) {
              group.passTrySum += (myInfo.pass.passTry || 0);
              group.passSuccessSum += (myInfo.pass.passSuccess || 0);
            }
          }
        } catch (e) {
          console.warn(`매치 상세 실패: ${matchId}`);
        }
        await sleep(10);
      }

      result.users[nickname] = opponentGroup;
      console.log(`[완료] ${nickname}`);
    } catch (e) {
      console.error(`[에러] ${nickname}:`, e.message);
    }
  }

  fs.writeFileSync('./data.json', JSON.stringify(result, null, 2));
  console.log('data.json 저장 완료!');
}

build();
