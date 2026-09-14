import { useEffect, useState, useSyncExternalStore } from "react";
import { ParticipantTile, useTracks } from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { RemoteAudioTrack, Track } from "livekit-client";
import { Minimize2, Users, EyeOff, MicOff, Volume2, VolumeX } from "lucide-react";
import {
  getVolume,
  isScreenAudioMuted,
  toggleScreenAudioMute,
  isDeafened,
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

  return (
    <button
      className={`tile-audio-btn ${screenMuted ? "muted" : ""}`}
      title={
        screenMuted
          ? `Áudio desta tela mutado — clique pra ouvir`
          : `Mutar o áudio desta tela (continua ouvindo a voz de ${identity})`
      }
      onClick={(e) => {
        e.stopPropagation();
        toggleScreenAudioMute(identity);
      }}
    >
      {screenMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
    </button>
  );
}

// O botão da tela guarda a preferência por participante em localAudioPrefs.
// Esta ponte é o que a aplica de fato na track remota entregue pelo LiveKit.
// Mantemos separado do áudio do microfone para poder silenciar o jogo/vídeo
// compartilhado sem deixar de ouvir a voz da mesma pessoa.
function ScreenShareAudioController({
  identity,
  audioTrack,
}: {
  identity: string;
  audioTrack: Track | undefined;
}) {
  const muted = useSyncExternalStore(subscribe, () => isScreenAudioMuted(identity));
  // Ensurdecer silencia TUDO que vem de fora, incluindo o áudio da tela
  // compartilhada — sem mexer na preferência de mute daquela tela, que
  // volta a valer sozinha assim que a pessoa desensurdecer.
  const deafened = useSyncExternalStore(subscribe, () => isDeafened());

  useEffect(() => {
    if (audioTrack instanceof RemoteAudioTrack) {
      audioTrack.setVolume(muted || deafened ? 0 : 1);
    }
  }, [audioTrack, muted, deafened]);

  return null;
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

  // ScreenShare e ScreenShareAudio são publications diferentes no LiveKit.
  // A grade usa só o vídeo, mas precisamos observar a track de áudio também
  // para que o mute da transmissão seja real, e não apenas visual.
  const screenAudioTracks = useTracks(
    [{ source: Track.Source.ScreenShareAudio, withPlaceholder: false }],
    { onlySubscribed: true }
  );

  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [hideOthers, setHideOthers] = useState(false);

  const focusedTrack = focusedKey ? tracks.find((t) => trackKey(t) === focusedKey) ?? null : null;
  const screenAudioControllers = screenAudioTracks.map((trackRef) => (
    <ScreenShareAudioController
      key={trackKey(trackRef)}
      identity={trackRef.participant.identity}
      audioTrack={trackRef.publication?.track}
    />
  ));

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
        {screenAudioControllers}
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

  return (
    <>
      {screenAudioControllers}
      <div className="participant-grid">
        {tracks.map((t) => (
          <ClickableTile key={trackKey(t)} trackRef={t} onClick={() => setFocusedKey(trackKey(t))} />
        ))}
      </div>
    </>
  );
}
