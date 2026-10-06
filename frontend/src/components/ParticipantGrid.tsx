import { useEffect, useState, useSyncExternalStore } from "react";
import { ParticipantTile, useTracks } from "@livekit/components-react";
import "../speaking.css";
import "../screenAudio.css";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Minimize2, Users, EyeOff, MicOff, Volume2, VolumeX } from "lucide-react";
import {
  getScreenAudioVolume,
  getVolume,
  isScreenAudioMuted,
  setScreenAudioVolume,
  toggleScreenAudioMute,
  subscribe,
} from "../localAudioPrefs";

function trackKey(t: TrackReferenceOrPlaceholder): string {
  return `${t.participant.identity}-${t.source}`;
}

// Câmera/avatar mostra se você mutou a VOZ da pessoa (controlado na
// sidebar). Tela compartilhada mostra — e permite controlar — o ÁUDIO DA
// TELA especificamente, direto em cima da transmissão (não na pessoa),
// pra ficar claro que é independente da voz dela.
function MutedBadge({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const identity = trackRef.participant.identity;
  const voiceMuted = useSyncExternalStore(subscribe, () => getVolume(identity) === 0);
  if (!voiceMuted) return null;

  return (
    <div className="tile-muted-badge" title={`Você mutou ${identity}`}>
      <MicOff size={14} />
    </div>
  );
}

function ScreenAudioButton({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const identity = trackRef.participant.identity;
  const screenMuted = useSyncExternalStore(subscribe, () => isScreenAudioMuted(identity));
  const volume = useSyncExternalStore(subscribe, () => getScreenAudioVolume(identity));
  const shownVolume = screenMuted ? 0 : volume;

  return (
    <div className="tile-audio-control" onClick={(e) => e.stopPropagation()}>
      <button
        className={`tile-audio-btn ${screenMuted || volume === 0 ? "muted" : ""}`}
        title={
          screenMuted
            ? `Áudio desta tela mutado — clique pra ouvir`
            : `Mutar o áudio desta tela (continua ouvindo a voz de ${identity})`
        }
        onClick={() => toggleScreenAudioMute(identity)}
      >
        {shownVolume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      <input
        className="tile-audio-slider"
        type="range"
        min={0}
        max={100}
        value={Math.round(shownVolume * 100)}
        title={`Volume da tela: ${Math.round(shownVolume * 100)}%`}
        onChange={(e) => {
          const next = Number(e.target.value) / 100;
          setScreenAudioVolume(identity, next);
          // Mexer no volume com a tela mutada = quer ouvir de novo.
          if (screenMuted && next > 0) toggleScreenAudioMute(identity);
        }}
      />
    </div>
  );
}

function ClickableTile({
  trackRef,
  onClick,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  onClick: () => void;
}) {
  const isScreenShare = trackRef.source === Track.Source.ScreenShare;
  return (
    <div className="focusable-tile" onClick={onClick}>
      <ParticipantTile trackRef={trackRef} />
      {!trackRef.participant.isLocal && !isScreenShare && <MutedBadge trackRef={trackRef} />}
      {!trackRef.participant.isLocal && isScreenShare && <ScreenAudioButton trackRef={trackRef} />}
    </div>
  );
}

export default function ParticipantGrid() {
  // withPlaceholder: true na câmera faz cada participante aparecer com um
  // "avatar" mesmo sem vídeo ligado — é o que dá a sensação de "tela de
  // chamada" tipo Discord, mostrando todo mundo que está na call.
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const hasScreenShare = tracks.some((t) => t.source === Track.Source.ScreenShare);

  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [hideOthers, setHideOthers] = useState(false);
  // Esconder as câmeras/avatares da grade normal (não focada), deixando
  // só as telas compartilhadas — que aí ocupam o espaço sozinhas (o
  // CSS Grid já se reorganiza automaticamente, não precisa calcular
  // tamanho na mão). Só faz sentido oferecer esse botão quando tem
  // alguma tela compartilhada ativa (ver hasScreenShare abaixo).
  const [hideParticipants, setHideParticipants] = useState(false);

  const focusedTrack = focusedKey ? tracks.find((t) => trackKey(t) === focusedKey) ?? null : null;
  // Se a pessoa que você focou parar de compartilhar/sair, volta sozinho
  // pra grade em vez de ficar numa tela quebrada.
  useEffect(() => {
    if (focusedKey && !focusedTrack) {
      setFocusedKey(null);
    }
  }, [focusedKey, focusedTrack]);

  if (focusedTrack) {
    const others = tracks.filter((t) => trackKey(t) !== focusedKey);
    return (
      <>
        <div className="focus-view">
          <div className="focus-toolbar">
            <button className="unfocus-btn" onClick={() => setFocusedKey(null)}>
              <Minimize2 size={16} /> Voltar pra grade
            </button>
            {others.length > 0 && (
              <button className="unfocus-btn" onClick={() => setHideOthers((v) => !v)}>
                {hideOthers ? <Users size={16} /> : <EyeOff size={16} />}
                {hideOthers ? "Mostrar participantes" : "Esconder participantes"}
              </button>
            )}
          </div>

          <div className="focus-main">
            <ParticipantTile trackRef={focusedTrack} />
            {!focusedTrack.participant.isLocal &&
              (focusedTrack.source === Track.Source.ScreenShare ? (
                <ScreenAudioButton trackRef={focusedTrack} />
              ) : (
                <MutedBadge trackRef={focusedTrack} />
              ))}
          </div>

          {!hideOthers && others.length > 0 && (
            <div className="focus-strip">
              {others.map((t) => (
                <div key={trackKey(t)} className="focus-strip-item">
                  <ClickableTile trackRef={t} onClick={() => setFocusedKey(trackKey(t))} />
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  const visibleTracks = hideParticipants
    ? tracks.filter((t) => t.source === Track.Source.ScreenShare)
    : tracks;

  return (
    <>
      <div className="participant-grid-wrapper">
        {hasScreenShare && (
          <div className="focus-toolbar">
            <button className="unfocus-btn" onClick={() => setHideParticipants((v) => !v)}>
              {hideParticipants ? <Users size={16} /> : <EyeOff size={16} />}
              {hideParticipants ? "Mostrar participantes" : "Esconder participantes"}
            </button>
          </div>
        )}
        <div className="participant-grid">
          {visibleTracks.map((t) => (
            <ClickableTile key={trackKey(t)} trackRef={t} onClick={() => setFocusedKey(trackKey(t))} />
          ))}
        </div>
      </div>
    </>
  );
}
