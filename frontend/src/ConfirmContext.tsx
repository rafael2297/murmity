import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // Botão de confirmar em vermelho — usa pra ação destrutiva (apagar,
  // remover), deixa no azul padrão (accent) pra confirmação neutra.
  danger?: boolean;
}

interface PendingConfirm extends Required<ConfirmOptions> {
  id: number;
  resolve: (value: boolean) => void;
}

interface Toast {
  id: number;
  message: string;
}

interface ConfirmContextValue {
  /**
   * Substitui window.confirm(). Sempre assíncrono (o modal é React, não
   * bloqueia a thread como o confirm() nativo do navegador) — por isso
   * precisa de await. Aceita string direto (vira {message: string}) ou
   * o objeto completo pra título/rótulos/estilo customizados.
   */
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  /**
   * Substitui alert(err.message) — todo uso de alert() no app hoje é
   * report de erro, então só existe essa variante (não um alert()
   * genérico de sucesso/info, que não tinha caso de uso real ainda).
   * Não bloqueia; some sozinho depois de alguns segundos.
   */
  notifyError: (message: string) => void;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

const TOAST_DURATION_MS = 6000;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const normalized: ConfirmOptions = typeof options === "string" ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      idRef.current += 1;
      setPending({
        id: idRef.current,
        title: normalized.title ?? "Confirmar ação",
        message: normalized.message,
        confirmLabel: normalized.confirmLabel ?? "Confirmar",
        cancelLabel: normalized.cancelLabel ?? "Cancelar",
        danger: normalized.danger ?? false,
        resolve,
      });
    });
  }, []);

  function settle(value: boolean) {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  }

  const notifyError = useCallback((message: string) => {
    idRef.current += 1;
    const id = idRef.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <ConfirmContext.Provider value={{ confirm, notifyError }}>
      {children}

      {pending && (
        <div className="modal-backdrop" onClick={() => settle(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{pending.title}</h3>
            <p>{pending.message}</p>
            <div className="confirm-modal-actions">
              <button className="secondary-btn" onClick={() => settle(false)}>
                {pending.cancelLabel}
              </button>
              <button
                className={`confirm-modal-confirm-btn ${pending.danger ? "danger" : ""}`}
                onClick={() => settle(true)}
                autoFocus
              >
                {pending.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className="toast toast-error">
              <AlertTriangle size={16} className="toast-icon" />
              <span className="toast-message">{toast.message}</span>
              <button className="toast-close" onClick={() => dismissToast(toast.id)} title="Fechar">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm precisa ser usado dentro de um ConfirmProvider");
  }
  return ctx;
}
