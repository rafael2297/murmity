import { useEffect, useRef } from "react";
import { RoomEvent, RemoteTrack, RemoteTrackPublication, Track } from "livekit-client";
import { useRoomContext } from "@livekit/components-react";
import { useSoundboardVolume } from "../SoundboardVolumeContext";

/**
 * Fica montado dentro do <LiveKitRoom> (ver Workspace.tsx) só ouvindo por
 * tracks de áudio extras chamadas "soundboard" (ver soundboard.ts) e
 * tocando elas — o RoomAudioRenderer padrão da lib não sabe lidar com
 * tracks fora de microfone/tela, então cuidamos manualmente aqui, do
 * mesmo jeito que o áudio da tela compartilhada já é tratado à parte.
 *
 * Aplica o volume do soundboard (SoundboardVolumeContext) em cada som
 * que chega de outra pessoa — o mesmo controle também se aplica aos seus
 * próprios sons (o monitor local, tratado em soundboard.ts).
 */
export default function SoundboardAudioRenderer() {
  const room = useRoomContext();
  const { volume } = useSoundboardVolume();
  const elementsRef = useRef(new Map<string, HTMLAudioElement>());
  const volumeRef = useRef(volume);

  // Guarda o valor mais recente numa ref pra usar dentro do listener do
  // LiveKit sem precisar recriar o listener toda vez que o volume muda.
  useEffect(() => {
    volumeRef.current = volume;
    // Atualiza AO VIVO qualquer som que já esteja tocando no momento em
    // que o usuário mexe no controle (não só os próximos).
    elementsRef.current.forEach((el) => {
      el.volume = volume;
    });
  }, [volume]);

  useEffect(() => {
    function handleSubscribed(track: RemoteTrack, publication: RemoteTrackPublication) {
      if (track.kind !== Track.Kind.Audio || publication.trackName !== "soundboard") return;

      const el = document.createElement("audio");
      el.autoplay = true;
      el.volume = volumeRef.current;
      el.srcObject = new MediaStream([track.mediaStreamTrack]);
      document.body.appendChild(el);
      elementsRef.current.set(publication.trackSid, el);

      el.play().catch(() => {
        // Autoplay bloqueado pelo navegador raramente acontece aqui
        // (já teve interação do usuário pra entrar na call), mas não
        // deixamos isso quebrar nada se acontecer.
      });
    }

    function handleUnsubscribed(_track: RemoteTrack, publication: RemoteTrackPublication) {
      const el = elementsRef.current.get(publication.trackSid);
      if (el) {
        el.pause();
        el.remove();
        elementsRef.current.delete(publication.trackSid);
      }
    }

    room.on(RoomEvent.TrackSubscribed, handleSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleUnsubscribed);

    return () => {
      room.off(RoomEvent.TrackSubscribed, handleSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleUnsubscribed);
      elementsRef.current.forEach((el) => el.remove());
      elementsRef.current.clear();
    };
  }, [room]);

  return null;
}
