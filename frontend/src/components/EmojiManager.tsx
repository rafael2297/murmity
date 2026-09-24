import { useState, FormEvent } from "react";
import { Trash2, Plus } from "lucide-react";
import { CustomEmoji } from "../api";
import { useConfirm } from "../ConfirmContext";
import { useChatConnection } from "../ChatConnectionContext";

interface Props {
  backendUrl: string;
  username: string;
}

/**
 * Gerenciar emojis personalizados (adicionar/remover) fica nas
 * Configurações — mesma lógica do soundboard: gerenciar é uma coisa,
 * usar (o EmojiPicker, no chat) é outra.
 *
 * A lista em si (`customEmojis`) vem do ChatConnectionContext —
 * compartilhada com o resto do app e atualizada ao vivo por WebSocket
 * (emoji_created/emoji_deleted), então nem precisa buscar nem mexer no
 * estado local depois de adicionar/remover: a atualização chega sozinha
 * pelo mesmo canal que os outros usuários também recebem.
 */
export default function EmojiManager({ backendUrl, username }: Props) {
  const { confirm, notifyError } = useConfirm();
  const { customEmojis, uploadEmoji, deleteEmoji } = useChatConnection();

  const [newCode, setNewCode] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(emoji: CustomEmoji) {
    const confirmed = await confirm({
      title: "Remover emoji",
      message: `Remover o emoji :${emoji.code}:?`,
      confirmLabel: "Remover",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteEmoji(emoji.id);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Erro ao remover emoji");
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newFile) return;
    setUploading(true);
    setError(null);
    try {
      await uploadEmoji(newCode.trim(), newFile);
      setNewCode("");
      setNewFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao adicionar emoji");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      {customEmojis.length === 0 ? (
        <p className="device-select-empty">Nenhum emoji personalizado ainda — adicione um abaixo.</p>
      ) : (
        <ul className="soundboard-manage-list">
          {customEmojis.map((emoji) => (
            <li key={emoji.id} className="soundboard-manage-item emoji-manage-item">
              <img
                className="emoji-manage-preview"
                src={`${backendUrl}${emoji.url}`}
                alt={emoji.code}
              />
              <span>:{emoji.code}:</span>
              {emoji.addedBy === username && (
                <button
                  className="icon-btn small muted"
                  onClick={() => handleDelete(emoji)}
                  title="Remover emoji"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="soundboard-error">{error}</p>}

      <form className="soundboard-upload-form" onSubmit={handleUpload}>
        <input
          type="text"
          placeholder="Código (ex: buzina, vira :buzina:)"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          maxLength={32}
        />
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
        />
        <button
          className="secondary-btn soundboard-add-btn"
          type="submit"
          disabled={uploading || !newCode.trim() || !newFile}
        >
          <Plus size={14} /> {uploading ? "Enviando..." : "Adicionar"}
        </button>
        <p className="device-select-note">
          Sem limite de quantidade de emojis — só evite imagens muito grandes (até 5&nbsp;MB
          cada). Use só letras minúsculas, números e "_" no código.
        </p>
      </form>
    </>
  );
}
