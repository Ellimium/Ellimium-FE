import Link from "next/link";

export default function Home() {
  return (
    <main className="lobby-shell">
      <header className="topbar">
        <Link className="brand" href="/">ELLIMIUM</Link>
        <nav aria-label="주요 메뉴">
          <Link className="nav-active" href="/">캠페인</Link>
          <Link href="/room">플레이 룸</Link>
        </nav>
        <Link className="avatar" href="/login" aria-label="프로필">L</Link>
      </header>
      <section className="lobby-hero">
        <div>
          <p className="eyebrow">YOUR CAMPAIGNS</p>
          <h1>다시, 모험을<br />이어갈 시간입니다.</h1>
          <p className="muted">최근 캠페인을 열거나 새로운 이야기를 시작하세요.</p>
        </div>
        <button className="primary-button" type="button">＋ 새 캠페인</button>
      </section>
      <section className="campaign-grid" aria-label="캠페인 목록">
        <article className="campaign-card campaign-card-featured">
          <div className="card-art ruins-art"><span>진행 중</span></div>
          <div className="card-body">
            <p className="eyebrow">D&amp;D 5E · 7회차</p><h2>잿빛 왕관의 유산</h2>
            <p className="muted">황혼의 수도, 카르멘 성문 앞</p>
            <div className="card-footer"><div className="party" aria-label="플레이어 4명"><i>엘</i><i>카</i><i>린</i><i>＋1</i></div><Link className="text-button" href="/room">계속하기 →</Link></div>
          </div>
        </article>
        <article className="campaign-card">
          <div className="card-art forest-art"><span>휴식 중</span></div>
          <div className="card-body">
            <p className="eyebrow">CALL OF CTHULHU · 3회차</p><h2>안개 아래의 마을</h2>
            <p className="muted">2026년 9월 6일 마지막 플레이</p>
            <div className="card-footer"><div className="party" aria-label="플레이어 3명"><i>유</i><i>한</i><i>민</i></div><Link className="text-button" href="/room">열기 →</Link></div>
          </div>
        </article>
        <button className="campaign-card new-card" type="button"><span className="new-card-icon">＋</span><strong>새 캠페인 만들기</strong><span>빈 테이블에서 시작</span></button>
      </section>
      <footer className="lobby-footer">ELLIMIUM · PERSONAL VIRTUAL TABLETOP</footer>
    </main>
  );
}
