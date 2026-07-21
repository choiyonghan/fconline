import { createClient } from '@supabase/supabase-js';

// 1. 환경 변수 확인
const NEXON_API_KEY = process.env.NEXON_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!NEXON_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ 환경변수가 올바르게 설정되지 않았습니다.");
  process.exit(1);
}

// 2. Supabase 클라이언트 생성 (Secret Key 사용으로 RLS 우회 권한 획득)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// API 호출 공통 헤더
const nexonHeaders = {
  "x-nxopen-api-key": NEXON_API_KEY
};

// 수집 대상 유저 닉네임 목록 (필요에 따라 자유롭게 변경 가능)
const TARGET_NICKNAMES = ["내혀를가져가"]; // 예시 닉네임

async function main() {
  console.log("🚀 데이터 수집 파이프라인 시작...");

  for (const nickname of TARGET_NICKNAMES) {
    try {
      console.log(`\n🔍 [${nickname}] 데이터 수집 시작`);

      // A. OUID 조회
      const ouidRes = await fetch(`https://open.api.nexon.com/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`, { headers: nexonHeaders });
      if (!ouidRes.ok) {
        console.error(`❌ OUID 조회 실패 (${nickname}):`, await ouidRes.text());
        continue;
      }
      const { ouid } = await ouidRes.json();

      // 유저 정보 users 테이블에 저장 (UPSERT)
      await supabase.from('users').upsert({ ouid, nickname, updated_at: new Date().toISOString() });

      // B. 최근 매치 목록 조회 (공식경기 limit 10개)
      const matchType = 50; // 50: 공식경기 (필요시 조정)
      const matchesRes = await fetch(`https://open.api.nexon.com/fconline/v1/user/match?ouid=${ouid}&matchtype=${matchType}&offset=0&limit=10`, { headers: nexonHeaders });
      if (!matchesRes.ok) continue;
      
      const matchIds = await matchesRes.json();
      console.log(`📌 최근 매치 ${matchIds.length}개 발견`);

      // C. 매치 상세정보 조회 및 저장
      for (const matchId of matchIds) {
        // 1. 이미 DB에 존재하는 매치인지 먼저 확인 (SELECT)
        const { data: existingMatch } = await supabase
          .from('matches')
          .select('match_id')
          .eq('match_id', matchId)
          .maybeSingle(); // single() 대신 maybeSingle()을 쓰면 결과가 없을 때 에러가 나지 않고 null을 반환합니다.

        // 2. 이미 DB에 존재하면 넥슨 API를 부르지 않고 스킵! (API 트래픽 절약)
        if (existingMatch) {
          console.log(`  └ ⏭️ 이미 존재하는 매치입니다. 스킵: ${matchId}`);
          continue;
        }

        // 3. DB에 없는 새로운 매치인 경우에만 넥슨 API 호출
        const detailRes = await fetch(`https://open.api.nexon.com/fconline/v1/match-detail?matchid=${matchId}`, { headers: nexonHeaders });
        if (!detailRes.ok) {
          console.error(`  └ ❌ 매치 상세정보 API 호출 실패 (${matchId})`);
          continue;
        }
        const matchData = await detailRes.json();

        // 4) matches 테이블 저장
        await supabase.from('matches').insert({
          match_id: matchData.matchId,
          match_date: matchData.matchDate,
          match_type: matchType
        });

        // 5) match_details 테이블 저장 (내 정보 & 상대방 정보 각각 가공)
        const myInfo = matchData.matchInfo.find(m => m.ouid === ouid);
        const opponentInfo = matchData.matchInfo.find(m => m.ouid !== ouid) || {};

        if (!myInfo) continue;

        const detailPayload = {
          match_id: matchData.matchId,
          ouid: myInfo.ouid,
          opponent_ouid: opponentInfo.ouid || 'UNKNOWN',
          opponent_nick: opponentInfo.nickname || '익명',

          // 경기 결과 및 조작기
          match_result: myInfo.matchDetail?.matchResult || '무',
          controller: myInfo.matchDetail?.controller || 'unknown',
          average_rating: myInfo.matchDetail?.averageRating || 0,

          // 슈팅 & 득점
          goals_for: myInfo.shoot?.goalTotalDisplay ?? 0,
          goals_against: opponentInfo.shoot?.goalTotalDisplay ?? 0,
          shoot_total: myInfo.shoot?.shootTotal ?? 0,
          effective_shoot: myInfo.shoot?.effectiveShootTotal ?? 0,
          goal_in_penalty: myInfo.shoot?.goalInPenalty ?? 0,
          goal_out_penalty: myInfo.shoot?.goalOutPenalty ?? 0,
          shoot_heading: myInfo.shoot?.shootHeading ?? 0,
          own_goal: myInfo.shoot?.ownGoal ?? 0,

          // 점유 & 패스
          possession: myInfo.matchDetail?.possession ?? 0,
          pass_try: myInfo.pass?.passTry ?? 0,
          pass_success: myInfo.pass?.passSuccess ?? 0,
          short_pass_try: myInfo.pass?.shortPassTry ?? 0,
          through_pass_try: myInfo.pass?.throughPassTry ?? 0,
          through_pass_success: myInfo.pass?.throughPassSuccess ?? 0,

          // 수비
          tackle_try: myInfo.defence?.tackleTry ?? 0,
          tackle_success: myInfo.defence?.tackleSuccess ?? 0,
          foul: myInfo.matchDetail?.foul ?? 0,
          yellow_cards: myInfo.matchDetail?.yellowCards ?? 0,
          red_cards: myInfo.matchDetail?.redCards ?? 0,

          // 상세 JSONB
          shoot_detail: myInfo.shootDetail || [],
          player_squad: myInfo.player || []
        };

        const { error } = await supabase.from('match_details').upsert(detailPayload, { onConflict: 'match_id,ouid' });
        
        if (error) {
          console.error(`  └ ❌ 상세 정보 저장 실패 (${matchId}):`, error.message);
        } else {
          console.log(`  └ ✅ 새 매치 수집 완료: ${matchId}`);
        }
      }

    } catch (err) {
      console.error(`❌ [${nickname}] 처리 중 오류 발생:`, err);
    }
  }

  console.log("\n🎉 모든 데이터 수집 파이프라인이 완료되었습니다!");
}

main();
