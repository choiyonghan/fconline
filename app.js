// 상대 카드를 클릭했을 때 호출되는 함수
function handleOpponentCardClick(cardElement, opponentData) {
  const detailCard = document.getElementById('detailCard');

  // 1. 이미 열려있는 카드를 다시 누른 경우 -> 닫기 (토글)
  if (cardElement.classList.contains('selected') && detailCard.style.display !== 'none') {
    detailCard.style.display = 'none';
    cardElement.classList.remove('selected');
    return;
  }

  // 2. 다른 선택 카드들의 'selected' 효과 해제
  document.querySelectorAll('.op-card').forEach(c => c.classList.remove('selected'));

  // 3. 현재 카드 선택 표시
  cardElement.classList.add('selected');

  // 4. [핵심] 클릭한 카드 바로 아래로 detailCard 위치 이동 (아코디언)
  cardElement.after(detailCard);

  // 5. 상세 데이터 채우기
  renderDetailReport(opponentData);

  // 6. 상세 카드 보이기
  detailCard.style.display = 'block';

  // 7. 클릭 위치로 스무스하게 스크롤 조정 (모바일 편의성)
  cardElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 상대 데이터 렌더링 예시
function renderDetailReport(data) {
  document.getElementById('detailTitle').textContent = `${data.name || '상대'} 상세 리포트`;
  // ... 기타 득점/어시스트/선방 데이터 채우는 기존 코드 ...
}
