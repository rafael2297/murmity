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
 * A correção é só tocar Microphone aqui — excluindo ScreenShareAudio e
 * Unknown de propósito:
 * - ScreenShareAudio: já é tratado pelo ParticipantGrid.tsx via
 *   ScreenShareAudioController, que aplica mute/volume por participante
 *   (respeitando a preferência local de cada um).
 * - Unknown: soundboard é tratado pelo SoundboardAudioRenderer.tsx.
 *
 * Assim cada tipo de áudio tem UM único dono responsável por tocar e
 * controlar volume, sem conflito.
 */
export default function VoiceAudioRenderer() {
  const tracks = useTracks([Track.Source.Microphone], {
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
