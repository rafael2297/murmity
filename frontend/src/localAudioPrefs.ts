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

// Plano B de eco ao compartilhar a tela: enquanto está ligado, TODO áudio
// vindo dos outros toca com volume 0 — mas isso é só um "interruptor"
// temporário em memória, que NÃO mexe no volume salvo de ninguém. Antes o
// volume salvo (localStorage) era zerado e restaurado depois; se o app
// fechasse no meio do compartilhamento, a pessoa ficava gravada como
// "mutada" pra sempre (era o "aparece mutada mesmo não estando").
let screenShareMuting = false;

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
  return deafened || screenShareMuting ? 0 : getVolume(identity);
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

/**
 * Plano B de eco: enquanto você compartilha a tela com o áudio do sistema
 * inteiro (Windows que não separa o áudio do Murmity), tudo que vem dos
 * outros toca com volume 0 pra a voz deles não voltar pra quem assiste.
 * Vale também pra quem entrar no meio do compartilhamento. Não altera o
 * volume salvo de ninguém e não afeta o que os outros ouvem.
 *
 * @returns Função pra desligar (chamar ao parar o compartilhamento)
 */
export function muteAllForScreenShare(_identities?: string[]): () => void {
  screenShareMuting = true;
  notify();
  return () => {
    screenShareMuting = false;
    notify();
  };
}

/**
 * Verifica se o mute do compartilhamento de tela está ativo.
 */
export function isScreenShareMutingActive(): boolean {
  return screenShareMuting;
}

// Conserto único: versões anteriores gravavam volume 0 (mutado) quando você
// compartilhava a tela e não restauravam se o app fechasse no meio. Isso
// deixava gente "mutada" sem você ter mutado. Na primeira execução desta
// versão, volta quem estiver em 0 para o último volume conhecido (ou 100%).
// (Quem você mutou DE PROPÓSITO também volta uma vez — é só mutar de novo.)
(function repairStuckVolumes() {
  const FLAG = "audioPrefsRepairV1";
  try {
    if (localStorage.getItem(FLAG)) return;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(VOLUME_PREFIX) || localStorage.getItem(key) !== "0") continue;
      const identity = key.slice(VOLUME_PREFIX.length);
      const last = Number(localStorage.getItem(LAST_VOLUME_PREFIX + identity) || "1");
      localStorage.setItem(key, String(last > 0 ? last : 1));
    }
    localStorage.setItem(FLAG, "1");
  } catch {
    // sem localStorage: nada a consertar
  }
})();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
