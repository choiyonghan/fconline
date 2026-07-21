import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

// 1. 수집 대상 닉네임 목록 (DB에 없으면 자동으로 OUID를 조회하여 등록합니다)
const TARGET_NICKNAMES = [
  'D로쏘네리',
  '내혀를가져가는',
  '내눈을가져가',
  '지린성에사는욱구',
  '욱냥0I',
  '서울쥐',
  '아기블루스',
  'ST반니스텔로이',
  '프란체스co토티'
];

// 2. 환경 변수 및 설정
const NEXON_API_KEYS = [
  process.env.NEXON_API_KEY,
  process.env.NEXON_API_KEY_2,
  process.env.NEXON_API_KEY_3
].filter(Boolean);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (NEXON_API_KEYS.length === 0 || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ 필수 환경변수가 설정되지 않았습니다.");
  process.exit(1);
}

let currentApiKeyIndex = 0;

// 3. Supabase 클라이언트 생성
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 4. API 키 로테이션 및 429 대응 Fetch 함수
async function fetchNexonApi(url) {
  while (currentApiKeyIndex < NEXON_API_KEYS.length) {
    const apiKey = NEXON_API_KEYS[currentApiKeyIndex];
    
    try {
      const response = await fetch(url, {
        headers: { "x-nxopen-api-key": apiKey }
      });

      if (response.status === 429) {
        console.warn(`⚠️ [429 제한 발생] ${currentApiKeyIndex + 1}번 API 키 제한 초과. 다음 키로 교체합니다.`);
        currentApiKeyIndex++;

        if (currentApiKeyIndex < NEXON_API_KEYS.length) {
          await sleep(200);
          continue;
        } else {
          throw new Error("❌ 모든 API 키가 요청 제한(429)에 도달했습니다.");
        }
      }

      if (!response.ok) {
        throw new Error(`API 오류 (Status: ${response.status})`);
      }

      return await response.json();
    } catch (err) {
      if (err.message.includes("429")) throw err;
      console.error(`  └ API 호출 중 오류 발생: ${err.message}`);
      return null;
    }
  }

  throw new Error("사용 가능한 API 키가 없습니다.");
}

async function main() {
  console.log("🚀 FC 온라인 데이터 수집 파이프라인 시작...");

  const DELAY_MS = 100;

  // -------------------------------------------------------------
  // [보완된 로직] 수집 대상 닉네임 DB 검증 및 자동 등록 (OUID 동시 발급)
  // -------------------------------------------------------------
  console.log("\n📋 수집 대상 닉네임 DB 검증 및 자동 등록 중...");
  for (const nickname of TARGET_NICKNAMES) {
    const { data: existingUser } = await supabase
      .from('users')
      .select('nickname, ouid')
      .eq('nickname', nickname)
      .maybeSingle();

    if (!existingUser) {
      console.log(`  └ 🔍 [${nickname}] DB에 없어 OUID를 먼저 조회합니다...`);
      
      // OUID 가져오기
      const userData = await fetchNexonApi(`https://open.api.nexon.com/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`);
      await sleep(DELAY_MS);

      if (!userData || !userData.ouid) {
        console.error(`  └ ❌ [${nickname}] 넥슨 API에서 OUID를 찾을 수 없어 DB 추가를 스킵합니다.`);
        continue;
      }

      // OUID와 함께 Insert (Not Null 제약조건 위반 방지)
      const { error: insertError } = await supabase
        .from('users')
        .insert({ 
          nickname: nickname,
          ouid: userData.ouid 
        });

      if (insertError) {
        console.error(`  └ ❌ [${nickname}] DB 추가 실패:`, insertError.message);
      } else {
        console.log(`  └ ➕ [${nickname}] 신규 유저 등록 완료 (OUID: ${userData.ouid})`);
      }
    } else {
      console.log(`  └ 🆗 [${nickname}] 이미 DB에 존재하는 유저입니다.`);
    }
  }

  // -------------------------------------------------------------
  // 수집할 전체 유저 목록 가져오기
  // -------------------------------------------------------------
  const { data: users, error: userError } = await supabase.from('users').select('*');

  if (userError || !users || users.length === 0) {
    console.error("❌ 수집할 유저가 users 테이블에 존재하지 않습니다.");
    return;
  }

  console.log(`\n📌 총 ${users.length}명의 유저 데이터 수집/갱신을 진행합니다.`);

  for (const user of users) {
    let currentOuid = user.ouid;
    let currentNickname = user.nickname;

    try {
      console.log(`\n🔍 [${currentNickname}] 데이터 수집 시작`);

      // OUID 재확인 (혹시 등록되지 않은 기존 데이터가 있을 경우 대비)
      if (!currentOuid) {
        console.log(`  └ OUID 재조회 중...`);
        const userData = await fetchNexonApi(`https://open.api.nexon.com/fconline/v1/id?nickname=${encodeURIComponent(currentNickname)}`);
        
        if (!userData || !userData.ouid) {
          console.error(`  └ ❌ OUID를 가져오지 못했습니다 (${currentNickname})`);
          continue;
        }

        currentOuid = userData.ouid;
        await supabase.from('users').update({ 
          ouid: currentOuid, 
          updated_at: new Date().toISOString() 
        }).eq('nickname', currentNickname);

        console.log(`  └ ✅ OUID 발급 완료: ${currentOuid}`);
        await sleep(DELAY_MS);
      }

      // 2. 최근 매치 목록 조회 (매치타입 40, 최근 100경기)
      const matchType = 40;
      console.log(`  └ 최근 100경기 목록(매치타입 ${matchType}) 요청 중...`);
      const matchIds = await fetchNexonApi(`https://open.api.nexon.com/fconline/v1/user/match?ouid=${currentOuid}&matchtype=${matchType}&offset=0&limit=100`);

      if (!matchIds || matchIds.length === 0) {
        console.log(`  └ ⚠️ 수집된 매치 기록이 없습니다.`);
        continue;
      }

      console.log(`  └ 총 ${matchIds.length}개의 매치 ID 수집 완료. 상세 검사 및 저장 시작...`);

      let savedCount = 0;
      let skippedCount = 0;

      // 3. 매치 상세 조회 및 저장
      for (let i = 0; i < matchIds.length; i++) {
        const matchId = matchIds[i];

        // DB 존재 여부 미리 체크 (존재 시 넥슨 API 호출 스킵)
        const { data: existingMatch } = await supabase
          .from('matches')
          .select('match_id')
          .eq('match_id', matchId)
          .maybeSingle();

        if (existingMatch) {
          skippedCount++;
          continue; // API 호출 안 하고 바로 다음 매치로 스킵
        }

        // 새 매치만 상세 정보 API 호출
        const matchData = await fetchNexonApi(`https://open.api.nexon.com/fconline/v1/match-detail?matchid=${matchId}`);
        await sleep(DELAY_MS);

        if (!matchData || !matchData.matchInfo) continue;

        // matches 테이블 저장
        await supabase.from('matches').insert({
          match_id: matchData.matchId,
          match_date: matchData.matchDate,
          match_type: matchType
        });

        // 내 정보 & 상대방 정보 분류
        const myInfo = matchData.matchInfo.find(m => m.ouid === currentOuid);
        const opponentInfo = matchData.matchInfo.find(m => m.ouid !== currentOuid) || {};

        if (!myInfo) continue;

        const detailPayload = {
          match_id: matchData.matchId,
          ouid: myInfo.ouid,
          opponent_ouid: opponentInfo.ouid || 'UNKNOWN',
          opponent_nick: opponentInfo.nickname || '상대 미상',

          match_result: myInfo.matchDetail?.matchResult || '무',
          controller: myInfo.matchDetail?.controller || 'unknown',
          average_rating: myInfo.matchDetail?.averageRating || 0,

          goals_for: myInfo.shoot?.goalTotalDisplay ?? myInfo.shoot?.goalTotal ?? 0,
          goals_against: opponentInfo.shoot?.goalTotalDisplay ?? opponentInfo.shoot?.goalTotal ?? 0,
          shoot_total: myInfo.shoot?.shootTotal ?? 0,
          effective_shoot: myInfo.shoot?.effectiveShootTotal ?? 0,
          goal_in_penalty: myInfo.shoot?.goalInPenalty ?? 0,
          goal_out_penalty: myInfo.shoot?.goalOutPenalty ?? 0,
          shoot_heading: myInfo.shoot?.shootHeading ?? 0,
          own_goal: myInfo.shoot?.ownGoal ?? 0,

          possession: myInfo.matchDetail?.possession ?? 0,
          pass_try: myInfo.pass?.passTry ?? 0,
          pass_success: myInfo.pass?.passSuccess ?? 0,
          short_pass_try: myInfo.pass?.shortPassTry ?? 0,
          through_pass_try: myInfo.pass?.throughPassTry ?? 0,
          through_pass_success: myInfo.pass?.throughPassSuccess ?? 0,

          tackle_try: myInfo.defence?.tackleTry ?? 0,
          tackle_success: myInfo.defence?.tackleSuccess ?? 0,
          foul: myInfo.matchDetail?.foul ?? 0,
          yellow_cards: myInfo.matchDetail?.yellowCards ?? 0,
          red_cards: myInfo.matchDetail?.redCards ?? 0,

          shoot_detail: myInfo.shootDetail || [],
          player_squad: myInfo.player || []
        };

        const { error: detailError } = await supabase
          .from('match_details')
          .upsert(detailPayload, { onConflict: 'match_id,ouid' });

        if (detailError) {
          console.error(`  └ ❌ 저장 실패 (${matchId}): ${detailError.message}`);
        } else {
          savedCount++;
        }
      }

      console.log(`  └ 🎉 [${currentNickname}] 처리 완료 (신규 저장: ${savedCount}건, 기존 스킵: ${skippedCount}건)`);

    } catch (err) {
      console.error(`❌ [${currentNickname}] 스크립트 실행 중 에러:`, err.message);
    }
  }

  console.log("\n✅ 모든 유저의 전적 데이터 수집 파이프라인이 성공적으로 끝났습니다!");
}

main();
