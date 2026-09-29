import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";

export interface CapturedShortcut {
  /** KeyboardEvent.code da tecla final (não-modificadora) — usado pro push-to-talk em app. */
  code: string;
  /** Formato "acelerador" do Electron (ex: "CommandOrControl+Shift+M") — usado pro atalho global. */
  accelerator: string;
}

interface Props {
  /** Texto mostrado quando NÃO está gravando (rótulo já formatado da tecla/atalho atual). */
  label: string;
  /** true pro atalho global — o Electron exige pelo menos um modificador (senão bloquearia digitação normal em qualquer app). */
  requireModifier?: boolean;
  onCapture: (result: CapturedShortcut) => void;
}

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

function codeToAcceleratorKey(code: string, key: string): string {
  if (code.startsWith("Key")) return code.slice(3); // "KeyA" -> "A"
  if (code.startsWith("Digit")) return code.slice(5); // "Digit5" -> "5"
  if (/^F\d{1,2}$/.test(code)) return code; // F1..F12 já são um nome de tecla válido pro Electron
  if (code === "Space") return "Space";
  // Fallback pra pontuação/teclas sem um "code" com nome amigável.
  return key.length === 1 ? key.toUpperCase() : code;
}

/**
 * Botão de "gravar tecla" — clica, pressiona a combinação desejada, pronto.
 * Usado tanto pro push-to-talk (uma tecla só, sem exigir modificador) quanto
 * pro atalho global de mudo (exige Ctrl/Alt/Shift/Cmd junto, formato do
 * Electron) — ver PushToTalkSettings.tsx.
 */
export default function ShortcutRecorder({ label, requireModifier = false, onCapture }: Props) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (MODIFIER_CODES.has(e.code)) return; // ainda só o modificador — espera a tecla "final"

      if (requireModifier && !(e.ctrlKey || e.altKey || e.shiftKey || e.metaKey)) {
        setError("Segure Ctrl, Alt, Shift ou Cmd junto com a tecla");
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      parts.push(codeToAcceleratorKey(e.code, e.key));

      setRecording(false);
      setError(null);
      onCapture({ code: e.code, accelerator: parts.join("+") });
    }

    // Captura (terceiro argumento `true`) + preventDefault/stopPropagation
    // de propósito: enquanto grava, a tecla pressionada NÃO deve chegar em
    // mais nada da página (nem abrir menu, nem digitar em outro campo).
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recording, requireModifier]);

  return (
    <div className="shortcut-recorder">
      <button
        type="button"
        className={`shortcut-recorder-btn ${recording ? "recording" : ""}`}
        onClick={() => {
          setError(null);
          setRecording(true);
        }}
      >
        <Keyboard size={14} />
        {recording ? "Pressione uma tecla..." : label}
      </button>
      {error && <span className="shortcut-recorder-error">{error}</span>}
    </div>
  );
}
