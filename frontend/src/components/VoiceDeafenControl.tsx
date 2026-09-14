import { useRef, useSyncExternalStore } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Headphones, HeadphoneOff } from "lucide-react";
import { isDeafened, setDeafened, subscribe } from "../localAudioPrefs";

/**
 * Ensurdecer (deafen): silencia de vez tudo que vem dos outros — voz e
 * áudio de tela compartilhada — sem mexer nas preferências individuais
 * de volume/mute de cada participante (ver localAudioPrefs.ts), que
 * voltam a valer sozinhas assim que você desensurdecer.
 *
 * Igual ao Discord, ensurdecer também desliga seu mic (não faz sentido
 * continuar falando sem conseguir ouvir ninguém responder). Ao
 * desensurdecer, o mic só volta a ligar se estava ligado antes — se você
 * já estava mutado, continua mutado.
 *
 * Vive na mesma barra do mic (sidebar-bottom), então só é renderizado
 * dentro do contexto do <LiveKitRoom> (ver ChannelSidebar.tsx).
 */
export default function VoiceDeafenControl() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const deafened = useSyncExternalStore(subscribe, isDeafened);
  const micWasEnabled = useRef(false);

  async function toggleDeafen() {
    if (deafened) {
      setDeafened(false);
      if (micWasEnabled.current) {
        await localParticipant.setMicrophoneEnabled(true);
      }
    } else {
      micWasEnabled.current = isMicrophoneEnabled;
      setDeafened(true);
      if (isMicrophoneEnabled) {
        await localParticipant.setMicrophoneEnabled(false);
      }
    }
  }

  return (
    <button
      className={`icon-btn small ${deafened ? "muted" : ""}`}
      onClick={toggleDeafen}
      title={deafened ? "Desensurdecer" : "Ensurdecer"}
    >
      {deafened ? <HeadphoneOff size={16} /> : <Headphones size={16} />}
    </button>
  );
}
