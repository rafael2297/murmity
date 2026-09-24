import { useRef, useState } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { Video, VideoOff, ScreenShare, ScreenShareOff, PhoneOff, Music4 } from "lucide-react";
import { isEnvElectron } from "../host";
import ScreenSharePicker from "./ScreenSharePicker";
import ScreenShareQualityPicker, { ScreenShareQuality } from "./ScreenShareQualityPicker";
import SoundboardPanel from "./SoundboardPanel";

interface Props {
  backendUrl: string;
  authToken: string;
  channelName: string;
}

export default function VoiceUserBar({ backendUrl, authToken, channelName }: Props) {
  const room = useRoomContext();
  const { localParticipant, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [qualityPickerOpen, setQualityPickerOpen] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const pickerResolveRef = useRef<((sourceId: string | null) => void) | null>(null);
  const qualityResolveRef = useRef<((quality: ScreenShareQuality | null) => void) | null>(null);

  async function toggleCam() {
    await localParticipant.setCameraEnabled(!isCameraEnabled);
  }

  async function startScreenShare(quality: ScreenShareQuality) {
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
        audio: true,
        systemAudio: "include",
      },
      {
        videoEncoding: { maxBitrate: quality.maxBitrate, maxFramerate: quality.frameRate },
        simulcast: false,
      }
    );
  }

  async function toggleScreenShare() {
    try {
      if (isScreenShareEnabled) {
        await localParticipant.setScreenShareEnabled(false);
        return;
      }

      if (isEnvElectron()) {
        // No Electron, o Chromium embutido não mostra um seletor nativo
        // sozinho — mostramos o nosso (ScreenSharePicker) antes de pedir
        // o compartilhamento de verdade.
        const sourceId = await new Promise<string | null>((resolve) => {
          pickerResolveRef.current = resolve;
          setPickerOpen(true);
        });
        if (!sourceId) return; // cancelou no seletor
        await (window as any).electronAPI.setScreenShareSource(sourceId);
      }

      // Passo de qualidade — igual ao Discord, escolhe resolução/fps antes
      // de "ir ao vivo". No navegador, isso acontece ANTES do seletor
      // nativo do SO (que abre só quando setScreenShareEnabled é chamado).
      const quality = await new Promise<ScreenShareQuality | null>((resolve) => {
        qualityResolveRef.current = resolve;
        setQualityPickerOpen(true);
      });
      if (!quality) return; // cancelou na tela de qualidade

      await startScreenShare(quality);
    } catch (err) {
      console.warn("Usuário cancelou ou erro ao compartilhar tela:", err);
    }
  }

  function handlePick(sourceId: string | null) {
    setPickerOpen(false);
    pickerResolveRef.current?.(sourceId);
    pickerResolveRef.current = null;
  }

  function handleQualityConfirm(quality: ScreenShareQuality) {
    setQualityPickerOpen(false);
    qualityResolveRef.current?.(quality);
    qualityResolveRef.current = null;
  }

  function handleQualityCancel() {
    setQualityPickerOpen(false);
    qualityResolveRef.current?.(null);
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
          title="Compartilhar tela"
        >
          {isScreenShareEnabled ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
        </button>
        <button className="voice-feature-btn" onClick={() => setSoundboardOpen(true)} title="Soundboard">
          <Music4 size={18} />
        </button>
      </div>

      {pickerOpen && <ScreenSharePicker onPick={handlePick} />}
      {qualityPickerOpen && (
        <ScreenShareQualityPicker onConfirm={handleQualityConfirm} onCancel={handleQualityCancel} />
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
