import Link from "next/link";

import AuthGuard from "../auth-guard";
import Chat from "./chat";
import CharacterSheets from "./character-sheets";
import DiceRoll from "./dice-roll";
import GamePanels from "./game-panels";
import RoomHeader from "./header";
import Jukebox from "./jukebox-panel";
import MapRegistration from "./map-registration";
import Participants from "./participants";
import RoomFeaturePermissions from "./room-feature-permissions";
import { RoomJukeboxProvider } from "./room-jukebox";
import RoomMap from "./room-map";
import { RoomPermissionsProvider } from "./room-permissions";
import { RoomConnectionProvider } from "./room-connection";
import RoomTools from "./room-tools";

export default async function Room({ searchParams }: { searchParams: Promise<{ roomId?: string }> }) {
  const { roomId } = await searchParams;

  return (
    <AuthGuard><RoomConnectionProvider key={roomId ?? "no-room"}><RoomPermissionsProvider roomId={roomId}><RoomJukeboxProvider key={roomId ?? "no-room"} roomId={roomId}><main className="room-shell">
      <header className="room-topbar">
        <Link className="brand" href="/">ELLIMIUM</Link>
        <RoomHeader roomId={roomId} />
      </header>
      <RoomTools />
      <section className="map-stage" aria-label="게임 맵">
        <div className="map-toolbar"><button type="button">−</button><span>75%</span><button type="button">＋</button></div>
        <RoomMap roomId={roomId} />
      </section>
      <GamePanels roomId={roomId} panels={[
        { id: "map-registration", title: "맵 등록", content: <MapRegistration roomId={roomId} /> },
        { id: "participants", title: "참가자", content: <Participants roomId={roomId} /> },
        { id: "feature-permissions", title: "기능 권한", content: <RoomFeaturePermissions /> },
        { id: "character-sheets", title: "캐릭터 시트", content: <CharacterSheets roomId={roomId} /> },
        { id: "jukebox", title: "주크박스", content: <Jukebox /> },
        { id: "initiative", title: "턴 순서", content: <section className="initiative">
          <div className="panel-heading"><div><p className="eyebrow">COMBAT</p><h2>턴 순서</h2></div><span>2 라운드</span></div>
          <ol><li className="turn-active"><b>18</b><i className="mini-token">엘</i><span>엘리온<small>내 차례</small></span><em>12 / 18</em></li><li><b>15</b><i className="mini-token enemy">☠</i><span>해골 경비병</span><em>7 / 12</em></li><li><b>12</b><i className="mini-token">카</i><span>카일</span><em>21 / 24</em></li></ol>
          <button className="end-turn" type="button">턴 종료</button>
        </section> },
        { id: "chat", title: "채팅", content: <Chat roomId={roomId} /> },
        { id: "dice", title: "주사위", content: <DiceRoll roomId={roomId} /> },
      ]} />
    </main></RoomJukeboxProvider></RoomPermissionsProvider></RoomConnectionProvider></AuthGuard>
  );
}
