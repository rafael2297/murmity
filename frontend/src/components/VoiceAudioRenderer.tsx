import { Track } from "livekit-client";
import { useTracks, AudioTrack } from "@livekit/components-react";

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
      {tracks.map((t) => (
        <AudioTrack key={`${t.participant.identity}-${t.publication.trackSid}`} trackRef={t} />
      ))}
    </div>
  );
}
