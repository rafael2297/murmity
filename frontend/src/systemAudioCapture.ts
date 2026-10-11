import { AudioPresets, LocalAudioTrack, Track, type LocalParticipant } from "livekit-client";
import { onSystemAudioChunk, startSystemAudio, stopSystemAudio } from "./host";

/**
 * Áudio do PC SEM o áudio do Murmity, publicado como o áudio da tela
 * compartilhada. O Electron captura (módulo nativo) e manda lotes de áudio;
 * aqui eles viram uma faixa de áudio que vai pro LiveKit.
 *
 * Formato dos lotes: float32, estéreo intercalado (L R L R...), 48 kHz.
 */

// Processador de áudio (roda na thread de áudio): guarda os lotes numa fila
// e entrega 128 quadros por vez. Espera juntar ~40 ms antes de começar, pra
// absorver variações de chegada, e descarta o excesso se a fila crescer demais.
const WORKLET_SOURCE = `
class PcmQueueProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queuedFrames = 0;
    this.current = null;
    this.offset = 0;
    this.started = false;
    this.port.onmessage = (event) => {
      const samples = new Float32Array(event.data);
      this.queue.push(samples);
      this.queuedFrames += samples.length / 2;
      while (this.queuedFrames > 24000) {
        const dropped = this.queue.shift();
        this.queuedFrames -= dropped.length / 2;
      }
    };
  }

  process(inputs, outputs) {
    const channels = outputs[0];
    const left = channels[0];
    const right = channels[1] || channels[0];

    if (!this.started) {
      if (this.queuedFrames < 1920) {
        left.fill(0);
        right.fill(0);
        return true;
      }
      this.started = true;
    }

    for (let i = 0; i < left.length; i++) {
      if (!this.current || this.offset >= this.current.length) {
        this.current = this.queue.shift() || null;
        this.offset = 0;
        if (this.current) this.queuedFrames -= this.current.length / 2;
      }
      if (this.current) {
        left[i] = this.current[this.offset++];
        right[i] = this.current[this.offset++];
      } else {
        left[i] = 0;
        right[i] = 0;
        this.started = false; // acabou o áudio: espera juntar de novo
      }
    }
    return true;
  }
}
registerProcessor("pcm-queue", PcmQueueProcessor);
`;

interface RunningCapture {
  context: AudioContext;
  node: AudioWorkletNode;
  track: LocalAudioTrack;
  participant: LocalParticipant;
  unsubscribe: () => void;
}

let running: RunningCapture | null = null;

export function isSystemAudioRunning(): boolean {
  return running !== null;
}

/** Começa a capturar o áudio do PC e publica como áudio da tela. Devolve false se não foi possível. */
export async function startSystemAudioShare(participant: LocalParticipant): Promise<boolean> {
  if (running) return true;

  const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  let unsubscribe: (() => void) | null = null;
  let captureStarted = false;

  try {
    await context.resume();

    const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }

    const node = new AudioWorkletNode(context, "pcm-queue", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 2;
    node.connect(destination); // NÃO liga na saída de som: o áudio não toca de volta pra você.

    // Começa a ouvir os lotes ANTES de iniciar a captura, pra não perder o começo.
    unsubscribe = onSystemAudioChunk((chunk) => {
      const copy = new Uint8Array(chunk).buffer as ArrayBuffer;
      node.port.postMessage(copy, [copy]);
    });

    captureStarted = await startSystemAudio();
    if (!captureStarted) throw new Error("captura de áudio do PC indisponível");

    const mediaTrack = destination.stream.getAudioTracks()[0];
    const track = new LocalAudioTrack(mediaTrack, undefined, true);
    track.source = Track.Source.ScreenShareAudio;
    await participant.publishTrack(track, {
      source: Track.Source.ScreenShareAudio,
      audioPreset: AudioPresets.musicHighQualityStereo,
      dtx: false,
      red: false,
      forceStereo: true,
    });

    running = { context, node, track, participant, unsubscribe };
    return true;
  } catch (err) {
    console.warn("[Murmity] não foi possível compartilhar o áudio do PC:", err);
    unsubscribe?.();
    if (captureStarted) await stopSystemAudio();
    context.close().catch(() => {});
    return false;
  }
}

/** Para a captura e tira o áudio do PC do compartilhamento. Seguro de chamar a qualquer hora. */
export async function stopSystemAudioShare(): Promise<void> {
  const current = running;
  running = null;
  await stopSystemAudio();
  if (!current) return;

  current.unsubscribe();
  try {
    await current.participant.unpublishTrack(current.track, true);
  } catch {
    // já tinha sido removida (ex: o LiveKit desfaz o áudio ao parar a tela)
  }
  current.node.disconnect();
  current.context.close().catch(() => {});
}
