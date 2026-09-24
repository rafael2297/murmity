import { useEffect, useState } from "react";
import { Minus, Power } from "lucide-react";
import { onRequestCloseChoice, respondCloseChoice, CloseChoice } from "../host";

/**
 * Pergunta "minimizar ou fechar" quando a pessoa clica no X da janela do
 * app (Electron). Existe porque a caixinha nativa do sistema operacional
 * (dialog.showMessageBoxSync no processo principal) destoava muito do
 * visual do resto do app — isso aqui é só um modal React normal, no
 * mesmo estilo do SettingsModal/ScreenSharePicker.
 *
 * Fica montado UMA vez, no topo do App inteiro (ver App.tsx), porque o
 * pedido pode chegar em qualquer tela — login, hospedar, ou já dentro do
 * Workspace numa call.
 */
export default function CloseConfirmModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return onRequestCloseChoice(() => setOpen(true));
  }, []);

  function choose(choice: CloseChoice) {
    setOpen(false);
    respondCloseChoice(choice);
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => choose("cancel")}>
      <div className="close-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Fechar o Murmity</h3>
        <p>
          <strong>Minimizar</strong> deixa o Murmity rodando na bandeja, com a call e a conexão
          ativas. <strong>Fechar o programa</strong> encerra tudo — inclusive a sala, se você
          estiver hospedando.
        </p>

        <div className="close-confirm-actions">
          <button className="close-confirm-btn minimize" onClick={() => choose("minimize")} autoFocus>
            <Minus size={16} />
            Minimizar
          </button>
          <button className="close-confirm-btn quit" onClick={() => choose("quit")}>
            <Power size={16} />
            Fechar programa
          </button>
        </div>

        <button className="close-confirm-cancel" onClick={() => choose("cancel")}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
