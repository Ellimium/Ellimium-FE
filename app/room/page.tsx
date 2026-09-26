import Link from "next/link";

import AuthGuard from "../auth-guard";
import DiceRoll from "./dice-roll";
import RoomHeader from "./header";
import MapRegistration from "./map-registration";
import Participants from "./participants";
import RoomMap from "./room-map";

export default async function Room({ searchParams }: { searchParams: Promise<{ roomId?: string }> }) {
  const { roomId } = await searchParams;

  return (
    <AuthGuard><main className="room-shell">
      <header className="room-topbar">
        <Link className="brand" href="/">ELLIMIUM</Link>
        <RoomHeader roomId={roomId} />
      </header>
      <aside className="tool-rail" aria-label="맵 도구">
        <button className="tool-active" type="button" aria-label="선택">↖</button><button type="button" aria-label="이동">✥</button><button type="button" aria-label="그리기">✎</button><button type="button" aria-label="거리 측정">⌁</button><button type="button" aria-label="시야 설정">◐</button><span /><button type="button" aria-label="설정">⚙</button>
      </aside>
      <section className="map-stage" aria-label="게임 맵">
        <div className="map-toolbar"><button type="button">−</button><span>75%</span><button type="button">＋</button></div>
        <RoomMap roomId={roomId} />
      </section>
      <aside className="game-panel">
        <MapRegistration roomId={roomId} />
        <Participants roomId={roomId} />
        <section className="initiative">
          <div className="panel-heading"><div><p className="eyebrow">COMBAT</p><h2>턴 순서</h2></div><span>2 라운드</span></div>
          <ol><li className="turn-active"><b>18</b><i className="mini-token">엘</i><span>엘리온<small>내 차례</small></span><em>12 / 18</em></li><li><b>15</b><i className="mini-token enemy">☠</i><span>해골 경비병</span><em>7 / 12</em></li><li><b>12</b><i className="mini-token">카</i><span>카일</span><em>21 / 24</em></li></ol>
          <button className="end-turn" type="button">턴 종료</button>
        </section>
        <DiceRoll roomId={roomId} />
      </aside>
    </main></AuthGuard>
  );
}
