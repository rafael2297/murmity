import { LocalParticipant, Track } from "livekit-client";

/**
 * Toca um som do soundboard.
 *
 * Se `localParticipant` for passado (você está numa call), publica o
 * áudio como uma track extra no LiveKit com nome "soundboard" — assim
 * todo mundo na call ouve, igual ao soundboard do Discord. O
 * `SoundboardAudioRenderer` do lado de quem recebe é quem sabe
 * reconhecer essa track pelo nome e tocar ela (com o volume de recepção
 * DELE, independente do que a gente faz aqui).
 *
 * Publicar no LiveKit não faz você se ouvir de volta, então também
 * tocamos localmente ao mesmo tempo — esse monitor local passa por um
 * `GainNode` pra respeitar o mesmo controle de volume (`volume`,
 * 0 a 1, vindo de `SoundboardVolumeContext`), já que o pedido é o
 * controle valer pros SEUS sons também, não só pros que você recebe de
 * outra pessoa. O que é PUBLICADO pro LiveKit continua em volume cheio —
 * cada pessoa que ouve controla o volume de recepção dela mesma, do lado
 * dela (`SoundboardAudioRenderer`).
 *
 * Se não tiver `localParticipant` (fora de uma call), só toca localmente
 * — cobre o caso de eventualmente pré-visualizar um som antes de entrar.
 */
export async function playSoundboardSound(
  url: string,
  localParticipant?: LocalParticipant,
  volume = 1
): Promise<void> {
  if (!localParticipant) {
    const audio = new Audio(url);
    audio.volume = volume;
    await audio.play();
    return;
  }

  const audioContext = new AudioContext();
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;

  // Publica pro LiveKit em volume cheio — quem estiver na call ouve isso
  // vindo de você, controlando o volume de recepção do lado dele.
  const destination = audioContext.createMediaStreamDestination();
  source.connect(destination);

  // Monitor local (o que VOCÊ ouve ao tocar) passa por um GainNode pra
  // respeitar o controle de volume do soundboard.
  const gainNode = audioContext.createGain();
  gainNode.gain.value = volume;
  source.connect(gainNode);
  gainNode.connect(audioContext.destination);

  const [track] = destination.stream.getAudioTracks();
  const publication = await localParticipant.publishTrack(track, {
    name: "soundboard",
    source: Track.Source.Unknown,
  });

  source.start();

  source.onended = () => {
    localParticipant.unpublishTrack(publication.track ?? track);
    track.stop();
    audioContext.close();
  };
}
