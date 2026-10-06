import { useEffect, useRef, useSyncExternalStore } from "react";
import { Track } from "livekit-client";
import { useTracks, AudioTrack } from "@livekit/components-react";
import {
  getEffectiveVolume,
  getScreenAudioVolume,
  isDeafened,
  isScreenAudioMuted,
  isScreenShareMutingActive,
  subscribe,
} from "../localAudioPrefs";

// "trackRef" é opcional no AudioTrack; aqui ele é sempre obrigatório.
type TrackRef = NonNullable<React.ComponentProps<typeof AudioTrack>["trackRef"]>;

// Toca UMA track remota e é o dono do volume dela. Além do volume, liga o
// "muted" do próprio <audio>: o setVolume(0) do LiveKit ignora o 0 quando o
// elemento é criado depois dele (e só era aplicado com a grade da chamada
// aberta) — era por isso que o mute do compartilhamento era "só visual".
function PlayedAudio({ trackRef, volume }: { trackRef: TrackRef; volume: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const silent = volume === 0;
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = silent;
  });
  return <AudioTrack ref={audioRef} trackRef={trackRef} volume={volume} />;
}

function MicAudio({ trackRef }: { trackRef: TrackRef }) {
  const identity = trackRef.participant.identity;
  // Já considera ensurdecido e o mute temporário do compartilhamento.
  const volume = useSyncExternalStore(subscribe, () => getEffectiveVolume(identity));
  return <PlayedAudio trackRef={trackRef} volume={volume} />;
}

function ScreenAudio({ trackRef }: { trackRef: TrackRef }) {
  const identity = trackRef.participant.identity;
  const mutedByUser = useSyncExternalStore(subscribe, () => isScreenAudioMuted(identity));
  const deafened = useSyncExternalStore(subscribe, () => isDeafened());
  const shareMuting = useSyncExternalStore(subscribe, () => isScreenShareMutingActive());
  const userVolume = useSyncExternalStore(subscribe, () => getScreenAudioVolume(identity));
  return (
    <PlayedAudio
      trackRef={trackRef}
      volume={mutedByUser || deafened || shareMuting ? 0 : userVolume}
    />
  );
}

/**
 * Substitui o <RoomAudioRenderer /> padrão da lib.
 *
 * Por quê: o RoomAudioRenderer da @livekit/components-react toca TODA
 * track de áudio remota cujo source seja Microphone, ScreenShareAudio OU
 * Unknown (conferido lendo o código-fonte da própria lib, já que a
 * documentação não menciona esse terceiro). O problema é que qualquer
 * track publicada manualmente com um nome próprio — é exatamente o caso
 * do soundboard (`localParticipant.publishTrack(..., { name: "soundboard" })`
 * em soundboard.ts) — cai automaticamente em "Unknown" por padrão, sem a
 * gente pedir. Isso fazia o som do soundboard tocar DUAS VEZES em
 * paralelo: uma vez aqui (sem volume nenhum controlado, sempre no talo) e
 * outra pelo SoundboardAudioRenderer.tsx (que aplica o volume certo,
 * inclusive ao vivo enquanto o som já está tocando). O usuário só ouvia a
 * cópia errada por cima, que nunca abaixava.
 *
 * A correção é só tocar Microphone e ScreenShareAudio aqui — excluindo
 * Unknown de propósito — e deixar qualquer áudio "Unknown" (hoje só o
 * soundboard, mas vale pra qualquer track futura publicada manualmente do
 * mesmo jeito) inteiramente por conta de quem publicou essa track cuidar
 * do próprio player e volume.
 */
export default function VoiceAudioRenderer() {
  const tracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio], {
    onlySubscribed: true,
  }).filter((t) => !t.participant.isLocal);

  return (
    <div style={{ display: "none" }}>
      {tracks.map((t) => {
        const key = `${t.participant.identity}-${t.publication.trackSid}`;
        return t.source === Track.Source.ScreenShareAudio ? (
          <ScreenAudio key={key} trackRef={t} />
        ) : (
          <MicAudio key={key} trackRef={t} />
        );
      })}
    </div>
  );
}
