import { useEffect, useState } from "react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { fetchJoinToken, JoinTokenResult } from "../api";
import ChannelSidebar from "./ChannelSidebar";
import MainContent from "./MainContent";
import VoiceSoundEffects from "./VoiceSoundEffects";
import SoundboardAudioRenderer from "./SoundboardAudioRenderer";
import ReconnectBanner from "./ReconnectBanner";
import MemberSidebar from "./MemberSidebar";
import { playJoinSound, playLeaveSound } from "../soundEffects";
import { ensureNotificationPermission } from "../notifications";
import { ChatConnectionProvider } from "../ChatConnectionContext";
import { setDeafened } from "../localAudioPrefs";

// Canal de voz único (ver seção 11 do PROJECT_CONTEXT.md).
const VOICE_ROOM_NAME = "geral";

interface Props {
  backendUrl: string;
  authToken: string;
  username: string;
  onLogout: () => void;
}

export default function Workspace({ backendUrl, authToken, username, onLogout }: Props) {
  const [joinInfo, setJoinInfo] = useState<JoinTokenResult | null>(null);
  const [joining, setJoining] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [mainView, setMainView] = useState<"chat" | "call">("chat");
  const [showMembers, setShowMembers] = useState(true);

  useEffect(() => {
    ensureNotificationPermission();
  }, []);

  async function handleJoinVoice() {
    setVoiceError(null);

    // getUserMedia só funciona em contexto seguro (https ou localhost) —
    // ver PROJECT_CONTEXT.md seção 11 pra detalhes de por que isso importa.
    if (!navigator.mediaDevices) {
      setVoiceError(
        "Seu navegador bloqueou o acesso a microfone/câmera nesta página. " +
          `Isso acontece quando a página é acessada por IP (${window.location.hostname}) ` +
          "em vez de localhost. Acesse via http://localhost:5173 nesta máquina."
      );
      return;
    }

    setJoining(true);
    try {
      const info = await fetchJoinToken(backendUrl, authToken, VOICE_ROOM_NAME);
      setJoinInfo(info);
      playJoinSound();
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Erro ao entrar no canal de voz.");
    } finally {
      setJoining(false);
    }
  }

  // Ponto único de "a call acabou" — chamado tanto quando o usuário sai de
  // propósito (LiveKitRoom.onDisconnected dispara depois de room.disconnect())
  // quanto quando a conexão cai de vez (depois de esgotar as tentativas de
  // reconexão automática do próprio LiveKit). Evita duplicar lógica/som.
  function endCall(errorMessage?: string) {
    setJoinInfo((prev) => {
      if (prev) playLeaveSound();
      return null;
    });
    setMainView("chat");
    if (errorMessage) setVoiceError(errorMessage);
    // Ensurdecer é um estado "desta call" — sair não pode deixar a próxima
    // já entrando surda sem o usuário ter feito nada.
    setDeafened(false);
  }

  const layout = (
    <div className="discord-layout">
      <ChannelSidebar
        username={username}
        backendUrl={backendUrl}
        authToken={authToken}
        inCall={!!joinInfo}
        joining={joining}
        mainView={mainView}
        onJoinVoice={handleJoinVoice}
        onSelectChat={() => setMainView("chat")}
        onSelectCall={() => setMainView("call")}
        onLogout={onLogout}
      />
      <MainContent
        username={username}
        inCall={!!joinInfo}
        view={mainView}
        showMembers={showMembers}
        onToggleMembers={() => setShowMembers((visible) => !visible)}
        backendUrl={backendUrl}
        authToken={authToken}
      />
      {showMembers && <MemberSidebar />}
    </div>
  );

  return (
    <ChatConnectionProvider backendUrl={backendUrl} authToken={authToken} username={username}>
      {voiceError && <div className="voice-error-banner">{voiceError}</div>}

      {joinInfo ? (
        <LiveKitRoom
          data-lk-theme="default"
          serverUrl={joinInfo.url}
          token={joinInfo.token}
          connect
          audio
          video={false}
          onDisconnected={() => endCall()}
          onError={(err) => {
            // NÃO derruba a call aqui — erros transitórios de rede fazem
            // parte do processo normal de reconexão automática do LiveKit
            // (ver ReconnectBanner). Só onDisconnected (acima) encerra a
            // call de verdade, quando o LiveKit desiste de vez.
            console.warn("Aviso da LiveKitRoom (pode ser reconexão em andamento):", err);
          }}
          style={{ display: "contents" }}
        >
          <ReconnectBanner />
          <VoiceSoundEffects />
          <SoundboardAudioRenderer />
          {layout}
          <RoomAudioRenderer />
        </LiveKitRoom>
      ) : (
        layout
      )}
    </ChatConnectionProvider>
  );
}
