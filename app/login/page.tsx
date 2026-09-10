import Link from "next/link";

export default function Login() {
  return (
    <main className="login-shell">
      <section className="login-story">
        <Link className="brand" href="/">ELLIMIUM</Link>
        <div><p className="eyebrow">A PRIVATE VIRTUAL TABLETOP</p><h1>이야기가 머무는<br />우리만의 테이블.</h1><p>지도와 주사위, 캐릭터와 기록을 한곳에서.</p></div>
        <small>© 2026 ELLIMIUM</small>
      </section>
      <section className="login-panel">
        <form className="login-card">
          <p className="eyebrow">WELCOME BACK</p><h2>모험으로 돌아가기</h2>
          <label>이메일<input type="email" placeholder="adventurer@example.com" autoComplete="email" /></label>
          <label>비밀번호<input type="password" placeholder="••••••••" autoComplete="current-password" /></label>
          <div className="login-options"><label className="check"><input type="checkbox" /> 로그인 유지</label><button className="link-button" type="button">비밀번호 찾기</button></div>
          <Link className="primary-button full-button" href="/">로그인</Link>
          <p className="form-foot">초대받은 사용자만 가입할 수 있습니다.</p>
        </form>
      </section>
    </main>
  );
}
