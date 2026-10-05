import { useEffect, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext, useParticipants } from "@livekit/components-react";
import { ConnectionQuality, ParticipantEvent, Track } from "livekit-client";
import { Video, VideoOff, ScreenShare, ScreenShareOff, PhoneOff, Music4 } from "lucide-react";
import { canExcludeOwnAudio, isEnvElectron } from "../host";
import { useConfirm } from "../ConfirmContext";
import ScreenSharePicker from "./ScreenSharePicker";
import ScreenShareQualityPicker, { ScreenShareQuality, stepDownQuality } from "./ScreenShareQualityPicker";
import SoundboardPanel from "./SoundboardPanel";
import { muteAllForScreenShare } from "../localAudioPrefs";

interface Props {
  backendUrl: string;
  authToken: string;
  channelName: string;
}

// Resultado de cada passo do fluxo de compartilhar/editar tela — três
// desfechos possíveis, sempre os mesmos três nos dois passos (escolher
// fonte e escolher qualidade): seguiu em frente, cancelou (não mexe em
// nada que já esteja rolando) ou parou de vez a transmissão.
type PickerOutcome = { action: "pick"; sourceId: string } | { action: "cancel" } | { action: "stop" };
type QualityOutcome = { action: "confirm"; quality: ScreenShareQuality } | { action: "cancel" } | { action: "stop" };

// ---- Ajuste automático de qualidade (ver PROJECT_CONTEXT.md) ----
// Reage à "connectionQuality" que o próprio LiveKit já calcula (perda de
// pacote/RTT reportados pro SFU) — o mesmo sinal que já existe pra
// desenhar o indicador de conexão, não uma medição de banda nossa.
//
// Dois níveis de correção, do mais leve pro mais pesado:
//   1. Cortar só o TETO DE BITRATE de uma track que já está no ar, direto
//      no RTCRtpSender (sem restart, sem piscar nada) — é sempre a
//      primeira tentativa.
//   2. Só se isso não bastar (bitrate já no piso e a conexão continua
//      ruim), reduzir resolução/fps de verdade — que force um
//      para-e-começa-de-novo (mesmo mecanismo do modo "editar" manual, com
//      o mesmo piscar rápido documentado lá).
// Só existe correção pra BAIXO automática — se a conexão melhorar, o
// bitrate volta a subir sozinho (é só um número, não precisa reiniciar
// nada), mas resolução/fps só sobem de novo se a pessoa reabrir o menu de
// qualidade na mão. Isso evita ficar oscilando/piscando toda hora.
const POOR_QUALITY_DEBOUNCE_MS = 5000; // exige 5s seguidos de conexão "ruim" antes de agir
const STEP_DOWN_COOLDOWN_MS = 15000; // espera pelo menos isso entre dois cortes de resolução/fps
const EXCELLENT_QUALITY_EASE_MS = 20000; // 20s seguidos de conexão "excelente" antes de devolver banda
const BITRATE_STEP_DOWN_FACTOR = 0.7;
const BITRATE_STEP_UP_FACTOR = 1.2;
const MIN_BITRATE = 800_000; // piso de 800kbps — abaixo disso a imagem vira papa, não compensa

export default function VoiceUserBar({ backendUrl, authToken, channelName }: Props) {
  const room = useRoomContext();
  const { localParticipant, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  // Participantes remotos pra mutar quando share com áudio inicia
  const remoteParticipants = useParticipants().filter((p) => !p.isLocal);
  const { notifyInfo } = useConfirm();
  const [pickerMode, setPickerMode] = useState<"start" | "edit">("start");
  const [qualityMode, setQualityMode] = useState<"start" | "edit">("start");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [qualityPickerOpen, setQualityPickerOpen] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const pickerResolveRef = useRef<((outcome: PickerOutcome) => void) | null>(null);
  const qualityResolveRef = useRef<((outcome: QualityOutcome) => void) | null>(null);
  // Última qualidade aplicada — usada tanto pra pré-selecionar no modal de
  // edição quanto como TETO pro reajuste automático de bitrate (nunca
  // sobe além do que a pessoa escolheu de propósito).
  const [currentQuality, setCurrentQuality] = useState<ScreenShareQuality | undefined>(undefined);
  const currentQualityRef = useRef<ScreenShareQuality | undefined>(undefined);
  // Bitrate REALMENTE em uso agora — pode ser menor que currentQuality
  // .maxBitrate se o ajuste automático já cortou banda; é nele que a
  // recuperação gradual (quando a conexão melhora) se baseia.
  const activeBitrateRef = useRef<number | null>(null);
  const lastStepDownAtRef = useRef(0);
  // Cleanup function pro auto-mute do screen share
  const screenShareMuteCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    currentQualityRef.current = currentQuality;
  }, [currentQuality]);

  async function toggleCam() {
    await localParticipant.setCameraEnabled(!isCameraEnabled);
  }

  async function applyScreenShare(quality: ScreenShareQuality) {
    // O áudio do sistema é capturado SEM o áudio do próprio Murmity
    // (restrictOwnAudio abaixo), então você continua ouvindo os outros e eles
    // não se ouvem de volta. Só em PCs que não suportam isso (Windows mais
    // antigo) cai no plano B: muta os outros localmente pra evitar o eco.
    const ownAudioExcluded = await canExcludeOwnAudio();
    if (!ownAudioExcluded && remoteParticipants.length > 0) {
      const identities = remoteParticipants.map((p) => p.identity);
      screenShareMuteCleanupRef.current = muteAllForScreenShare(identities);
      notifyInfo("Seu Windows não consegue separar o áudio do Murmity do resto — o áudio dos outros ficou mutado localmente enquanto você compartilha, pra evitar eco pra quem assiste. Volta ao normal ao parar.");
    }

    await localParticipant.setScreenShareEnabled(
      true,
      {
        // contentHint "motion" evita a sensação de lag em conteúdo com
        // movimento rápido (jogos, vídeo) — resolução/fps agora vêm da
        // escolha da pessoa no ScreenShareQualityPicker, não são mais
        // fixos no código.
        resolution: { width: quality.width, height: quality.height, frameRate: quality.frameRate },
        contentHint: "motion",
        // Pede áudio do sistema/janela junto com a tela (equivalente ao
        // "compartilhar áudio" do Discord). No Electron, quem decide de
        // verdade é o main.cjs (audio: "loopback"); isso aqui é o pedido
        // do lado do navegador.
        // restrictOwnAudio: captura o áudio do sistema MENOS o do próprio
        // Murmity (o Electron 43.4+ traduz isso no main.cjs).
        audio: { restrictOwnAudio: true },
        systemAudio: "include",
      },
      {
        videoEncoding: { maxBitrate: quality.maxBitrate, maxFramerate: quality.frameRate },
        simulcast: false,
      }
    );
    setCurrentQuality(quality);
    activeBitrateRef.current = quality.maxBitrate;
  }

  async function stopScreenShare() {
    // Restaura volumes dos outros participantes que foram mutados pro share
    if (screenShareMuteCleanupRef.current) {
      screenShareMuteCleanupRef.current();
      screenShareMuteCleanupRef.current = null;
    }
    await localParticipant.setScreenShareEnabled(false);
    setCurrentQuality(undefined);
    activeBitrateRef.current = null;
  }

  /** Muda só o teto de bitrate de uma publicação já no ar — direto no RTCRtpSender, sem restart, sem piscar nada. */
  async function setScreenShareBitrateCeiling(bitrate: number) {
    const publication = localParticipant.getTrackPublication(Track.Source.ScreenShare);
    const sender = publication?.videoTrack?.sender;
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) return;
      params.encodings[0].maxBitrate = bitrate;
      await sender.setParameters(params);
      activeBitrateRef.current = bitrate;
    } catch (err) {
      console.warn("Não consegui ajustar o bitrate da tela compartilhada:", err);
    }
  }

  /**
   * Monitora a qualidade de conexão ENQUANTO a tela está sendo
   * compartilhada, e reage automaticamente quando ela fica ruim por
   * tempo demais (ver constantes/comentário acima). Timer se rearma
   * sozinho enquanto o nível continuar o mesmo — não depende do LiveKit
   * ficar reemitindo o evento (ele só emite quando o nível MUDA).
   */
  useEffect(() => {
    if (!isScreenShareEnabled) return;

    let level: ConnectionQuality = localParticipant.connectionQuality;
    let poorTimer: ReturnType<typeof setTimeout> | null = null;
    let excellentTimer: ReturnType<typeof setTimeout> | null = null;

    function clearTimers() {
      if (poorTimer) clearTimeout(poorTimer);
      if (excellentTimer) clearTimeout(excellentTimer);
      poorTimer = null;
      excellentTimer = null;
    }

    async function handleStepDown() {
      const quality = currentQualityRef.current;
      if (!quality) return;
      const lower = stepDownQuality(quality);
      if (!lower) return; // já está no degrau mais baixo — não tem mais o que reduzir
      lastStepDownAtRef.current = Date.now();
      try {
        await localParticipant.setScreenShareEnabled(false);
        await applyScreenShare(lower);
        notifyInfo(
          "A qualidade do compartilhamento de tela foi reduzida automaticamente — a conexão está instável. Clique no botão de compartilhar tela pra ajustar na mão."
        );
      } catch (err) {
        console.warn("Erro reduzindo qualidade automaticamente:", err);
      }
    }

    async function reactToPoorQuality() {
      const floorReached = (activeBitrateRef.current ?? Infinity) <= MIN_BITRATE;
      if (!floorReached) {
        const next = Math.max(
          MIN_BITRATE,
          Math.round((activeBitrateRef.current ?? MIN_BITRATE) * BITRATE_STEP_DOWN_FACTOR)
        );
        await setScreenShareBitrateCeiling(next);
      } else if (Date.now() - lastStepDownAtRef.current >= STEP_DOWN_COOLDOWN_MS) {
        await handleStepDown();
      }
      // Continua ruim? Arma de novo — cada rodada corta um pouco mais
      // (até esbarrar no piso, depois passa a reduzir resolução/fps).
      if (level === ConnectionQuality.Poor) {
        poorTimer = setTimeout(reactToPoorQuality, POOR_QUALITY_DEBOUNCE_MS);
      }
    }

    async function easeBitrateBackUp() {
      const ceiling = currentQualityRef.current?.maxBitrate;
      if (ceiling && (activeBitrateRef.current ?? 0) < ceiling) {
        const next = Math.min(
          ceiling,
          Math.round((activeBitrateRef.current ?? ceiling) * BITRATE_STEP_UP_FACTOR)
        );
        await setScreenShareBitrateCeiling(next);
      }
      if (level === ConnectionQuality.Excellent) {
        excellentTimer = setTimeout(easeBitrateBackUp, EXCELLENT_QUALITY_EASE_MS);
      }
    }

    function handleQualityChange(quality: ConnectionQuality) {
      level = quality;
      clearTimers();
      if (quality === ConnectionQuality.Poor) {
        poorTimer = setTimeout(reactToPoorQuality, POOR_QUALITY_DEBOUNCE_MS);
      } else if (quality === ConnectionQuality.Excellent) {
        excellentTimer = setTimeout(easeBitrateBackUp, EXCELLENT_QUALITY_EASE_MS);
      }
    }

    localParticipant.on(ParticipantEvent.ConnectionQualityChanged, handleQualityChange);
    return () => {
      localParticipant.off(ParticipantEvent.ConnectionQualityChanged, handleQualityChange);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScreenShareEnabled, localParticipant]);

  /**
   * Um fluxo só pros dois casos (começar do zero ou editar em andamento)
   * — a diferença entre os dois é só o `mode` passado pros modais (que
   * muda texto/botões) e o que acontece no final: "start" nunca tinha
   * nada rodando antes, "edit" já tinha, então troca por baixo dos panos
   * (para e começa de novo com a fonte/qualidade nova). O LiveKit não
   * garante uma troca "sem soltar" de verdade, então isso pode causar um
   * piscar rápido pra quem está assistindo — ver PROJECT_CONTEXT.md.
   */
  async function runScreenShareFlow(mode: "start" | "edit") {
    try {
      if (isEnvElectron()) {
        // No Electron, o Chromium embutido não mostra um seletor nativo
        // sozinho — mostramos o nosso (ScreenSharePicker) antes de pedir
        // o compartilhamento de verdade.
        const sourceOutcome = await new Promise<PickerOutcome>((resolve) => {
          pickerResolveRef.current = resolve;
          setPickerMode(mode);
          setPickerOpen(true);
        });
        if (sourceOutcome.action === "cancel") return; // mantém o que já estava rolando (se tinha)
        if (sourceOutcome.action === "stop") {
          await stopScreenShare();
          return;
        }
        await (window as any).electronAPI.setScreenShareSource(sourceOutcome.sourceId);
      }

      // Passo de qualidade — igual ao Discord, escolhe resolução/fps antes
      // de "ir ao vivo" (ou de aplicar a mudança, no modo edição). No
      // navegador, isso acontece ANTES do seletor nativo do SO (que abre
      // só quando setScreenShareEnabled é chamado).
      const qualityOutcome = await new Promise<QualityOutcome>((resolve) => {
        qualityResolveRef.current = resolve;
        setQualityMode(mode);
        setQualityPickerOpen(true);
      });
      if (qualityOutcome.action === "cancel") return; // mantém o que já estava rolando (se tinha)
      if (qualityOutcome.action === "stop") {
        await stopScreenShare();
        return;
      }

      if (mode === "edit") {
        // Troca de fonte/qualidade em andamento = parar e começar de novo
        // por baixo dos panos (ver comentário no topo da função).
        await localParticipant.setScreenShareEnabled(false);
      }
      await applyScreenShare(qualityOutcome.quality);
    } catch (err) {
      console.warn("Erro no fluxo de compartilhamento de tela:", err);
    }
  }

  function toggleScreenShare() {
    runScreenShareFlow(isScreenShareEnabled ? "edit" : "start");
  }

  function handlePick(sourceId: string) {
    setPickerOpen(false);
    pickerResolveRef.current?.({ action: "pick", sourceId });
    pickerResolveRef.current = null;
  }

  function handlePickerCancel() {
    setPickerOpen(false);
    pickerResolveRef.current?.({ action: "cancel" });
    pickerResolveRef.current = null;
  }

  function handlePickerStop() {
    setPickerOpen(false);
    pickerResolveRef.current?.({ action: "stop" });
    pickerResolveRef.current = null;
  }

  function handleQualityConfirm(quality: ScreenShareQuality) {
    setQualityPickerOpen(false);
    qualityResolveRef.current?.({ action: "confirm", quality });
    qualityResolveRef.current = null;
  }

  function handleQualityCancel() {
    setQualityPickerOpen(false);
    qualityResolveRef.current?.({ action: "cancel" });
    qualityResolveRef.current = null;
  }

  function handleQualityStop() {
    setQualityPickerOpen(false);
    qualityResolveRef.current?.({ action: "stop" });
    qualityResolveRef.current = null;
  }

  function leave() {
    room.disconnect();
  }

  return (
    <div className="voice-status-bar">
      <div className="voice-status-top">
        <div className="voice-status-info">
          <span className="voice-connected-dot" />
          <div>
            <div className="voice-status-title">Voz conectada</div>
            <div className="voice-status-sub"># {channelName}</div>
          </div>
        </div>
        <button className="icon-btn danger" onClick={leave} title="Desconectar">
          <PhoneOff size={18} />
        </button>
      </div>

      <div className="voice-status-features">
        <button
          className={`voice-feature-btn ${isCameraEnabled ? "on" : ""}`}
          onClick={toggleCam}
          title="Câmera"
        >
          {isCameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
        <button
          className={`voice-feature-btn ${isScreenShareEnabled ? "on" : ""}`}
          onClick={toggleScreenShare}
          title={isScreenShareEnabled ? "Editar transmissão" : "Compartilhar tela"}
        >
          {isScreenShareEnabled ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
        </button>
        <button className="voice-feature-btn" onClick={() => setSoundboardOpen(true)} title="Soundboard">
          <Music4 size={18} />
        </button>
      </div>

      {pickerOpen && (
        <ScreenSharePicker
          mode={pickerMode}
          onPick={handlePick}
          onCancel={handlePickerCancel}
          onStop={handlePickerStop}
        />
      )}
      {qualityPickerOpen && (
        <ScreenShareQualityPicker
          mode={qualityMode}
          initialQuality={currentQuality}
          onConfirm={handleQualityConfirm}
          onCancel={handleQualityCancel}
          onStop={handleQualityStop}
        />
      )}
      {soundboardOpen && (
        <SoundboardPanel
          onClose={() => setSoundboardOpen(false)}
          backendUrl={backendUrl}
          authToken={authToken}
        />
      )}
    </div>
  );
}
