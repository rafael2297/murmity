import { useState } from "react";
import { useChatConnection } from "../ChatConnectionContext";

interface Props {
  type: "text" | "voice";
  onClose: () => void;
}

const MAX_NAME_LENGTH = 60;

/**
 * O tipo (texto/voz) já vem decidido de qual "+" a pessoa clicou na
 * sidebar (ver ChannelSidebar.tsx) — aqui só falta o nome. A lista de
 * canais de todo mundo se atualiza sozinha via WebSocket assim que o
 * canal é criado (ver ChatConnectionContext), então esse modal só
 * precisa fechar depois do sucesso, sem manipular estado nenhum.
 */
export default function CreateChannelModal({ type, onClose }: Props) {
  const { createChannel } = useChatConnection();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError(null);
    try {
      await createChannel(trimmed, type);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar canal");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal create-channel-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Criar canal de {type === "text" ? "texto" : "voz"}</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            className="create-channel-input"
            placeholder="nome-do-canal"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
            autoFocus
          />
          {error && <div className="create-channel-error">{error}</div>}
          <div className="create-channel-actions">
            <button type="button" className="secondary-btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" disabled={!name.trim() || saving}>
              {saving ? "Criando..." : "Criar canal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
