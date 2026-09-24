import { X } from "lucide-react";
import { CustomEmoji } from "../api";
import { useChatConnection } from "../ChatConnectionContext";

interface Props {
  backendUrl: string;
  onClose: () => void;
  onSelectNative: (emoji: string) => void;
  onSelectCustom: (emoji: CustomEmoji) => void;
}

// Set curado de emoji nativos comuns — não é a lista completa do Unicode
// (isso pediria uma lib própria, tipo emoji-mart, com busca/categorias de
// verdade). Cobre o uso do dia a dia de um grupo de amigos; dá pra
// ampliar essa lista ou trocar por uma lib depois, se fizer falta.
const NATIVE_EMOJIS = [
  "😀", "😂", "😅", "😉", "😊", "😍", "😘", "😜", "🤔", "🙄",
  "😴", "😭", "😱", "😡", "🥳", "🤗", "🤝", "👍", "👎", "👏",
  "🙌", "🙏", "💪", "👀", "🔥", "✨", "💯", "🎉", "🎮", "🎵",
  "☕", "🍕", "🍺", "⚽", "🏆", "💀", "🤡", "😈", "👻", "🐱",
  "🐶", "🦆", "🐍", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤",
  "🤍", "😎", "🤯", "🥶", "🫡", "🙃", "😏", "🥲", "😬", "🤙",
];

/**
 * Painel de USAR emoji (nativo + personalizado) — aberto a partir do
 * botão no campo de mensagem. Adicionar/remover emoji personalizado fica
 * nas Configurações (EmojiManager.tsx), não aqui.
 */
export default function EmojiPicker({
  backendUrl,
  onClose,
  onSelectNative,
  onSelectCustom,
}: Props) {
  // Vem do ChatConnectionContext (compartilhado, atualizado ao vivo) em
  // vez de buscar aqui — assim um emoji adicionado agora mesmo já aparece
  // sem precisar reabrir o seletor.
  const { customEmojis } = useChatConnection();

  return (
    <div className="emoji-picker-backdrop" onClick={onClose}>
      <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
        <div className="emoji-picker-header">
          <span>Emojis</span>
          <button className="icon-btn small" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {customEmojis.length > 0 && (
          <>
            <div className="emoji-picker-section-title">Personalizados</div>
            <div className="emoji-picker-grid">
              {customEmojis.map((emoji) => (
                <button
                  key={emoji.id}
                  className="emoji-picker-item emoji-picker-item-custom"
                  title={`:${emoji.code}:`}
                  onClick={() => onSelectCustom(emoji)}
                >
                  <img src={`${backendUrl}${emoji.url}`} alt={emoji.code} />
                </button>
              ))}
            </div>
          </>
        )}

        <div className="emoji-picker-section-title">Emojis</div>
        <div className="emoji-picker-grid">
          {NATIVE_EMOJIS.map((emoji) => (
            <button key={emoji} className="emoji-picker-item" onClick={() => onSelectNative(emoji)}>
              {emoji}
            </button>
          ))}
        </div>

        <p className="device-select-note emoji-picker-note">
          Quer adicionar um emoji personalizado? Vá em Configurações → Emojis.
        </p>
      </div>
    </div>
  );
}
