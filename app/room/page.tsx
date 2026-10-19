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
import RoomQuickNavigation from "./room-quick-navigation";
import { RoomPermissionsProvider } from "./room-permissions";
import { RoomConnectionProvider } from "./room-connection";

export default async function Room({ searchParams }: { searchParams: Promise<{ roomId?: string }> }) {
  const { roomId } = await searchParams;

  return (
    <AuthGuard><RoomConnectionProvider key={roomId ?? "no-room"}><RoomPermissionsProvider roomId={roomId}><RoomJukeboxProvider key={roomId ?? "no-room"} roomId={roomId}><main className="room-shell">
      <header className="room-topbar">
        <Link className="brand" href="/">ELLIMIUM</Link>
        <RoomHeader roomId={roomId} />
      </header>
      <RoomQuickNavigation />
      <RoomMap roomId={roomId} />
      <GamePanels roomId={roomId} panels={[
        { id: "chat", title: "채팅", content: <Chat roomId={roomId} /> },
        { id: "dice", title: "주사위", content: <DiceRoll roomId={roomId} /> },
        { id: "character-sheets", title: "캐릭터 시트", content: <CharacterSheets roomId={roomId} /> },
        { id: "map-registration", title: "맵 등록", content: <MapRegistration roomId={roomId} /> },
        { id: "participants", title: "참가자", content: <Participants roomId={roomId} /> },
        { id: "feature-permissions", title: "기능 권한", content: <RoomFeaturePermissions /> },
        { id: "jukebox", title: "주크박스", content: <Jukebox /> },
      ]} />
    </main></RoomJukeboxProvider></RoomPermissionsProvider></RoomConnectionProvider></AuthGuard>
  );
}
