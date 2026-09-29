import { LocalParticipant, Track } from "livekit-client";

// GainNodes dos monitores locais tocando AGORA — é isso que permite mexer
// no volume enquanto um som já está tocando (ver updateSoundboardMonitorVolume
// abaixo). Cada som que termina se remove sozinho (source.onended).
const activeGainNodes = new Set<GainNode>();

/**
 * Aplica um volume novo em todo monitor local que já está tocando neste
 * exato momento — chamado pelo SoundboardPanel.tsx sempre que o usuário
 * mexe no slider de volume do soundboard, pra não precisar esperar o som
 * atual acabar pra sentir a mudança.
 */
export function updateSoundboardMonitorVolume(volume: number): void {
  activeGainNodes.forEach((node) => {
    node.gain.value = volume;
  });
}

/**
 * Toca um som do soundboard.
 *
 * Se `localParticipant` for passado (você está numa call), publica o
 * áudio como uma track extra no LiveKit com nome "soundboard" — assim
 * todo mundo na call ouve, igual ao soundboard do Discord. O
 * `VoiceAudioRenderer.tsx` (voz/tela) deliberadamente NÃO toca essa
 * track — só o `SoundboardAudioRenderer.tsx` do lado de quem recebe é
 * quem reconhece essa track pelo nome e toca ela, com o volume de
 * recepção DELE (independente do que a gente faz aqui), atualizado ao
 * vivo do lado dele também.
 *
 * Publicar no LiveKit não faz você se ouvir de volta, então também
 * tocamos localmente ao mesmo tempo — esse monitor local passa por um
 * `GainNode` pra respeitar o mesmo controle de volume (`volume`,
 * 0 a 1, vindo de `SoundboardVolumeContext`), já que o pedido é o
 * controle valer pros SEUS sons também, não só pros que você recebe de
 * outra pessoa. Esse GainNode fica registrado em `activeGainNodes`
 * enquanto o som toca, pra `updateSoundboardMonitorVolume` conseguir
 * ajustar ele ao vivo (não só na próxima vez que tocar algo). O que é
 * PUBLICADO pro LiveKit continua em volume cheio — cada pessoa que ouve
 * controla o volume de recepção dela mesma, do lado dela.
 *
 * Se não tiver `localParticipant` (fora de uma call), só toca localmente
 * — cobre o caso de eventualmente pré-visualizar um som antes de entrar.
 * Esse caso simples usa um <audio> comum, sem GainNode, então não
 * participa do ajuste ao vivo (não deveria durar tempo suficiente pra
 * isso importar — é só uma pré-visualização).
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
  // respeitar o controle de volume do soundboard — e pra dar pra ajustar
  // ao vivo, registrado em activeGainNodes enquanto durar.
  const gainNode = audioContext.createGain();
  gainNode.gain.value = volume;
  source.connect(gainNode);
  gainNode.connect(audioContext.destination);
  activeGainNodes.add(gainNode);

  const [track] = destination.stream.getAudioTracks();
  const publication = await localParticipant.publishTrack(track, {
    name: "soundboard",
    source: Track.Source.Unknown,
  });

  source.start();

  source.onended = () => {
    activeGainNodes.delete(gainNode);
    localParticipant.unpublishTrack(publication.track ?? track);
    track.stop();
    audioContext.close();
  };
}
