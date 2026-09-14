import { useLocalParticipant } from "@livekit/components-react";
import { Mic, MicOff } from "lucide-react";
import { isDeafened, setDeafened } from "../localAudioPrefs";

/**
 * Controle de mic isolado, pra viver na barra do usuário (sidebar-bottom)
 * em vez de junto com os outros botões de voz — igual ao Discord, que
 * separa o mic (fica sempre visível, junto com o seu nome) das features
 * da call (câmera/tela/soundboard, que ficam num bloco à parte).
 *
 * Só é renderizado quando `inCall` é verdadeiro (ver ChannelSidebar.tsx),
 * então sempre está dentro do contexto do <LiveKitRoom> quando montado.
 */
export default function VoiceMicControl() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();

  async function toggleMic() {
    const enabling = !isMicrophoneEnabled;
    // Ligar o mic manualmente enquanto ensurdecido também te desensurdece
    // — senão você estaria falando sem conseguir ouvir ninguém responder,
    // que não é o que a pessoa quer ao clicar aqui (mesmo comportamento
    // do Discord).
    if (enabling && isDeafened()) {
      setDeafened(false);
    }
    await localParticipant.setMicrophoneEnabled(enabling);
  }

  return (
    <button
      className={`icon-btn small ${!isMicrophoneEnabled ? "muted" : ""}`}
      onClick={toggleMic}
      title={isMicrophoneEnabled ? "Mutar" : "Desmutar"}
    >
      {isMicrophoneEnabled ? <Mic size={16} /> : <MicOff size={16} />}
    </button>
  );
}
