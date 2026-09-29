import { useEffect, useState } from "react";
import {
  isPushToTalkEnabled,
  setPushToTalkEnabled,
  getPushToTalkKeyCode,
  setPushToTalkKeyCode,
  getGlobalMuteShortcut,
  setGlobalMuteShortcut,
  labelForKeyCode,
  labelForAccelerator,
  subscribe,
} from "../pushToTalkPrefs";
import { isEnvElectron, registerMuteShortcut } from "../host";
import { useConfirm } from "../ConfirmContext";
import ShortcutRecorder from "./ShortcutRecorder";

/**
 * Configurações de voz por atalho de teclado. Duas coisas independentes:
 *
 * - Push-to-talk (segurar-pra-falar): funciona só com a janela do
 *   Murmity em foco (é ouvido aqui mesmo, no navegador — ver
 *   VoiceMicControl.tsx). Ativa/desativa o "mic sempre desligado a menos
 *   que eu esteja segurando a tecla".
 * - Atalho global de alternar mudo: funciona em qualquer lugar, até com
 *   outro programa em foco (um jogo, por exemplo) — mas só ALTERNA
 *   mudo/desmudo, não segura, porque o Electron não avisa quando a tecla
 *   é solta fora do próprio app. Só existe dentro do app instalado
 *   (Electron); no navegador essa seção nem aparece.
 */
export default function PushToTalkSettings() {
  const { notifyError, notifyInfo } = useConfirm();
  const [enabled, setEnabled] = useState(isPushToTalkEnabled());
  const [keyCode, setKeyCode] = useState(getPushToTalkKeyCode());
  const [globalShortcut, setGlobalShortcutState] = useState(getGlobalMuteShortcut());

  useEffect(() => {
    return subscribe(() => {
      setEnabled(isPushToTalkEnabled());
      setKeyCode(getPushToTalkKeyCode());
      setGlobalShortcutState(getGlobalMuteShortcut());
    });
  }, []);

  function handleToggle() {
    const next = !enabled;
    if (next && !keyCode) {
      notifyError("Defina uma tecla de push-to-talk antes de ativar.");
      return;
    }
    setPushToTalkEnabled(next);
  }

  async function handleCaptureGlobalShortcut(accelerator: string) {
    const ok = await registerMuteShortcut(accelerator);
    if (ok) {
      setGlobalMuteShortcut(accelerator);
      notifyInfo(`Atalho global de mudo definido: ${labelForAccelerator(accelerator)}`);
    } else {
      notifyError(
        `Não foi possível usar ${labelForAccelerator(accelerator)} — outro programa já deve estar usando essa combinação.`
      );
    }
  }

  async function handleClearGlobalShortcut() {
    await registerMuteShortcut(null);
    setGlobalMuteShortcut(null);
  }

  return (
    <div className="push-to-talk-settings">
      <div className="modal-section">
        <div className="modal-section-title">Push-to-talk (segurar pra falar)</div>
        <p className="settings-hint">
          Enquanto ligado, seu microfone fica desligado o tempo todo — só liga enquanto você segura a
          tecla escolhida. Funciona só com a janela do Murmity em foco.
        </p>

        <div className="push-to-talk-row">
          <button
            type="button"
            className={`ptt-toggle-btn ${enabled ? "on" : ""}`}
            onClick={handleToggle}
            title={enabled ? "Desativar push-to-talk" : "Ativar push-to-talk"}
          >
            {enabled ? "Ativado" : "Desativado"}
          </button>
          <ShortcutRecorder
            label={keyCode ? labelForKeyCode(keyCode) : "Nenhuma tecla definida"}
            onCapture={({ code }) => setPushToTalkKeyCode(code)}
          />
        </div>
      </div>

      {isEnvElectron() && (
        <div className="modal-section">
          <div className="modal-section-title">Atalho global de mudo</div>
          <p className="settings-hint">
            Alterna mudo/desmudo de qualquer lugar, mesmo com outro programa em foco (um jogo, por
            exemplo). Só alterna — não dá pra "segurar" um atalho global (limitação do sistema, não do
            Murmity).
          </p>

          <div className="push-to-talk-row">
            <ShortcutRecorder
              label={globalShortcut ? labelForAccelerator(globalShortcut) : "Nenhum atalho definido"}
              requireModifier
              onCapture={({ accelerator }) => handleCaptureGlobalShortcut(accelerator)}
            />
            {globalShortcut && (
              <button type="button" className="ptt-remove-btn" onClick={handleClearGlobalShortcut}>
                Remover
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
