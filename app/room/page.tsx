import Link from "next/link";

export default function Room() {
  return (
    <main className="room-shell">
      <header className="room-topbar">
        <Link className="brand" href="/">ELLIMIUM</Link>
        <div className="room-title"><strong>잿빛 왕관의 유산</strong><span>카르멘 성문 · 7회차</span></div>
        <div className="room-actions"><span className="live-dot">연결됨</span><button type="button">초대</button><Link href="/">나가기</Link></div>
      </header>
      <aside className="tool-rail" aria-label="맵 도구">
        <button className="tool-active" type="button" aria-label="선택">↖</button><button type="button" aria-label="이동">✥</button><button type="button" aria-label="그리기">✎</button><button type="button" aria-label="거리 측정">⌁</button><button type="button" aria-label="시야 설정">◐</button><span /><button type="button" aria-label="설정">⚙</button>
      </aside>
      <section className="map-stage" aria-label="게임 맵">
        <div className="map-toolbar"><button type="button">−</button><span>75%</span><button type="button">＋</button></div>
        <div className="battle-map">
          <div className="map-room room-a" /><div className="map-room room-b" /><div className="map-room room-c" />
          <span className="map-label gate-label">NORTH GATE</span><span className="map-label hall-label">OLD GUARD HALL</span>
          <button className="token token-mage" type="button" aria-label="엘리온, 마법사">엘</button><button className="token token-rogue" type="button" aria-label="카일, 도적">카</button><button className="token token-enemy" type="button" aria-label="해골 경비병">☠</button><button className="token token-enemy token-enemy-two" type="button" aria-label="해골 경비병">☠</button>
        </div>
        <div className="scene-tabs"><button className="scene-active" type="button">카르멘 성문</button><button type="button">지하 수로</button><button type="button">＋</button></div>
      </section>
      <aside className="game-panel">
        <section className="initiative">
          <div className="panel-heading"><div><p className="eyebrow">COMBAT</p><h2>턴 순서</h2></div><span>2 라운드</span></div>
          <ol><li className="turn-active"><b>18</b><i className="mini-token">엘</i><span>엘리온<small>내 차례</small></span><em>12 / 18</em></li><li><b>15</b><i className="mini-token enemy">☠</i><span>해골 경비병</span><em>7 / 12</em></li><li><b>12</b><i className="mini-token">카</i><span>카일</span><em>21 / 24</em></li></ol>
          <button className="end-turn" type="button">턴 종료</button>
        </section>
        <section className="chat-panel">
          <div className="panel-tabs"><button className="active" type="button">채팅</button><button type="button">기록</button></div>
          <div className="messages"><p className="system-message">전투가 시작되었습니다.</p><div className="message"><strong>GM</strong><span>무너진 회랑 너머에서 갑옷이 긁히는 소리가 들립니다.</span></div><div className="message"><strong>카일</strong><span>그림자에 몸을 숨기고 앞을 살펴볼게요.</span></div><div className="dice-message"><span>D20 · 은신</span><strong>17</strong><small>14 + 3</small></div></div>
          <form className="chat-input"><input aria-label="채팅 메시지" placeholder="메시지 또는 /roll 1d20" /><button type="button">↑</button></form>
        </section>
      </aside>
    </main>
  );
}
