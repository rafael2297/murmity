import { useEffect, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Mic, MicOff } from "lucide-react";
import { isDeafened, setDeafened } from "../localAudioPrefs";
import {
  isPushToTalkEnabled,
  getPushToTalkKeyCode,
  labelForKeyCode,
  subscribe as subscribePushToTalkPrefs,
} from "../pushToTalkPrefs";
import { onGlobalMuteToggle } from "../host";

/**
 * Controle de mic isolado, pra viver na barra do usuário (sidebar-bottom)
 * em vez de junto com os outros botões de voz — igual ao Discord, que
 * separa o mic (fica sempre visível, junto com o seu nome) das features
 * da call (câmera/tela/soundboard, que ficam num bloco à parte).
 *
 * Só é renderizado quando `inCall` é verdadeiro (ver ChannelSidebar.tsx),
 * então sempre está dentro do contexto do <LiveKitRoom> quando montado.
 *
 * Também é o dono da lógica de push-to-talk e do atalho global de mudo
 * (ver pushToTalkPrefs.ts e PushToTalkSettings.tsx pra onde configurar) —
 * faz sentido morar aqui porque os dois, no fim das contas, só chamam
 * `localParticipant.setMicrophoneEnabled`, igual o botão manual.
 */
export default function VoiceMicControl() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const [pttEnabled, setPttEnabled] = useState(isPushToTalkEnabled());
  const [pttKeyCode, setPttKeyCode] = useState(getPushToTalkKeyCode());

  useEffect(() => {
    return subscribePushToTalkPrefs(() => {
      setPttEnabled(isPushToTalkEnabled());
      setPttKeyCode(getPushToTalkKeyCode());
    });
  }, []);

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

  // Atalho GLOBAL de alternar mudo (funciona até com outro programa em
  // foco) — sempre disponível enquanto estiver numa call, independente do
  // push-to-talk estar ligado ou não (ver registerMuteShortcut em
  // App.tsx, que é quem registra o atalho em si no sistema operacional;
  // aqui só reage quando ele dispara).
  useEffect(() => {
    return onGlobalMuteToggle(() => {
      toggleMic();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localParticipant, isMicrophoneEnabled]);

  // Push-to-talk (segurar-pra-falar) — só funciona com a janela do
  // Murmity em foco, ouvido aqui mesmo via keydown/keyup do navegador (o
  // atalho GLOBAL acima é outra coisa, cobre o caso de estar noutro app).
  useEffect(() => {
    if (!pttEnabled || !pttKeyCode) return;

    // Ao (re)ativar — inclusive ao trocar de tecla — começa mutado; só
    // liga enquanto a tecla estiver mesmo sendo segurada.
    localParticipant.setMicrophoneEnabled(false);
    let held = false;

    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
    }

    function handleKeyDown(e: KeyboardEvent) {
      // `e.repeat` ignora os keydown repetidos que o SO manda sozinho
      // enquanto a tecla continua pressionada — sem isso ficaria
      // chamando setMicrophoneEnabled(true) várias vezes por segundo à
      // toa. `isTypingTarget` evita capturar a tecla enquanto a pessoa
      // está digitando no chat (importante principalmente se a tecla
      // escolhida for Espaço).
      if (e.code !== pttKeyCode || e.repeat || held || isTypingTarget(e.target)) return;
      held = true;
      if (isDeafened()) setDeafened(false);
      localParticipant.setMicrophoneEnabled(true);
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (e.code !== pttKeyCode) return;
      held = false;
      localParticipant.setMicrophoneEnabled(false);
    }

    // Se a janela perder o foco com a tecla ainda segurada (ex: Alt+Tab
    // no meio do aperto), o keyup nunca chega até nós — sem isso o mic
    // ficaria ligado até a pessoa voltar e apertar a tecla de novo.
    function handleBlur() {
      if (held) {
        held = false;
        localParticipant.setMicrophoneEnabled(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [pttEnabled, pttKeyCode, localParticipant]);

  const title = pttEnabled
    ? `Push-to-talk ativo — segure ${pttKeyCode ? labelForKeyCode(pttKeyCode) : "?"} pra falar (clique pra alternar manualmente)`
    : isMicrophoneEnabled
      ? "Mutar"
      : "Desmutar";

  return (
    <button
      className={`icon-btn small ${!isMicrophoneEnabled ? "muted" : ""}`}
      onClick={toggleMic}
      title={title}
    >
      {isMicrophoneEnabled ? <Mic size={16} /> : <MicOff size={16} />}
    </button>
  );
}
