/**
 * Preferências de áudio "só pra mim" (volume/mute de cada participante,
 * do jeito que você prefere ouvir — não afeta o que os outros ouvem).
 * Compartilhado entre a lista de participantes (sidebar) e a grade de
 * vídeo, pra os dois lugares mostrarem o mesmo estado.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

const VOLUME_PREFIX = "voiceVolume:";
const LAST_VOLUME_PREFIX = "voiceVolumeLast:"; // lembra o volume de antes de mutar
const SCREEN_AUDIO_MUTED_PREFIX = "screenAudioMuted:";

// Ensurdecer (deafen) é um estado global da call, não por participante —
// por isso vive em memória (não no localStorage): é algo do tipo "agora,
// nesta chamada", não uma preferência que deveria sobreviver a reiniciar
// o app com ninguém conectado. Igual ao Discord.
let deafened = false;

export function isDeafened(): boolean {
  return deafened;
}

export function setDeafened(value: boolean) {
  if (deafened === value) return;
  deafened = value;
  notify();
}

export function toggleDeafen(): boolean {
  setDeafened(!deafened);
  return deafened;
}

export function getVolume(identity: string): number {
  const raw = localStorage.getItem(VOLUME_PREFIX + identity);
  const value = raw ? Number(raw) : 1;
  // HTMLMediaElement.volume só aceita 0-1 — nunca deixar passar disso.
  return Math.min(Math.max(value, 0), 1);
}

// Volume que deve ser aplicado de fato na track de áudio: respeita o
// volume por participante, mas o ensurdecer global sempre vence (0),
// sem apagar a preferência individual salva — ao desensurdecer, cada
// um volta a tocar no volume que já estava configurado antes.
export function getEffectiveVolume(identity: string): number {
  return deafened ? 0 : getVolume(identity);
}

export function isMuted(identity: string): boolean {
  return getVolume(identity) === 0;
}

export function setVolume(identity: string, value: number) {
  const clamped = Math.min(Math.max(value, 0), 1);
  localStorage.setItem(VOLUME_PREFIX + identity, String(clamped));
  if (clamped > 0) {
    localStorage.setItem(LAST_VOLUME_PREFIX + identity, String(clamped));
  }
  notify();
}

export function toggleMute(identity: string) {
  if (isMuted(identity)) {
    const last = Number(localStorage.getItem(LAST_VOLUME_PREFIX + identity) || "1");
    setVolume(identity, last > 0 ? last : 1);
  } else {
    setVolume(identity, 0);
  }
}

// Áudio da TELA compartilhada — separado do volume da voz de propósito
// (ex: quiser ver a tela do jogo de alguém sem ouvir o áudio do jogo dele,
// mas continuar ouvindo a voz dessa pessoa normalmente).
export function isScreenAudioMuted(identity: string): boolean {
  return localStorage.getItem(SCREEN_AUDIO_MUTED_PREFIX + identity) === "1";
}

export function toggleScreenAudioMute(identity: string) {
  const next = !isScreenAudioMuted(identity);
  localStorage.setItem(SCREEN_AUDIO_MUTED_PREFIX + identity, next ? "1" : "0");
  notify();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
