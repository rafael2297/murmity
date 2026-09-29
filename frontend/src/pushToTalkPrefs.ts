/**
 * Preferências de push-to-talk (segurar-pra-falar) e do atalho global de
 * alternar mudo — pessoais, salvas só no seu `localStorage` (cada pessoa
 * configura a sua tecla, não é compartilhado nem sincronizado com
 * ninguém).
 *
 * Duas coisas BEM diferentes moram aqui, mesmo relacionadas:
 *
 * - Push-to-talk "de verdade" (segurar a tecla, soltar muta): só funciona
 *   com a janela do Murmity em foco — é ouvido via keydown/keyup direto
 *   no navegador (ver VoiceMicControl.tsx). Tecla identificada por
 *   `KeyboardEvent.code` (ex: "Space", "AltLeft") — não é afetada por
 *   layout de teclado nem por Shift/idioma.
 *
 * - Atalho GLOBAL (funciona com outro programa em foco, tipo um jogo):
 *   só sabe ALTERNAR mudo, não segurar — o `globalShortcut` do Electron
 *   não tem evento de soltura (ver PROJECT_CONTEXT.md pra detalhes).
 *   Formato "acelerador" do Electron (ex: "CommandOrControl+Shift+M").
 */

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const ENABLED_KEY = "pushToTalkEnabled";
const KEY_CODE_KEY = "pushToTalkKeyCode";
const GLOBAL_SHORTCUT_KEY = "globalMuteShortcut";

export function isPushToTalkEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "1";
}

export function setPushToTalkEnabled(value: boolean) {
  localStorage.setItem(ENABLED_KEY, value ? "1" : "0");
  notify();
}

/** `KeyboardEvent.code` da tecla de segurar-pra-falar, ou null se nunca configurada. */
export function getPushToTalkKeyCode(): string | null {
  return localStorage.getItem(KEY_CODE_KEY);
}

export function setPushToTalkKeyCode(code: string | null) {
  if (code) localStorage.setItem(KEY_CODE_KEY, code);
  else localStorage.removeItem(KEY_CODE_KEY);
  notify();
}

/** Acelerador do Electron (ex: "CommandOrControl+Shift+M") pro atalho global de alternar mudo, ou null. */
export function getGlobalMuteShortcut(): string | null {
  return localStorage.getItem(GLOBAL_SHORTCUT_KEY);
}

export function setGlobalMuteShortcut(accelerator: string | null) {
  if (accelerator) localStorage.setItem(GLOBAL_SHORTCUT_KEY, accelerator);
  else localStorage.removeItem(GLOBAL_SHORTCUT_KEY);
  notify();
}

// ---- Rótulos amigáveis pra exibir na UI ----

const CODE_LABELS: Record<string, string> = {
  Space: "Espaço",
  ControlLeft: "Ctrl esquerdo",
  ControlRight: "Ctrl direito",
  AltLeft: "Alt esquerdo",
  AltRight: "Alt direito",
  ShiftLeft: "Shift esquerdo",
  ShiftRight: "Shift direito",
  CapsLock: "Caps Lock",
  Tab: "Tab",
  Backquote: "` (crase)",
};

/** Rótulo pra mostrar na UI pra um `KeyboardEvent.code` (ex: "Space" -> "Espaço"). */
export function labelForKeyCode(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  // "KeyA" -> "A", "Digit5" -> "5", "F5" -> "F5" (já legível), resto (ex:
  // "Backslash") mantém o code cru — ainda dá pra entender.
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/** Rótulo pra mostrar na UI pra um acelerador do Electron (ex: "CommandOrControl+Shift+M" -> "Ctrl+Shift+M"). */
export function labelForAccelerator(accelerator: string): string {
  return accelerator.replace("CommandOrControl", navigator.platform.startsWith("Mac") ? "Cmd" : "Ctrl");
}
