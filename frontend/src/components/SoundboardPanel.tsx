import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useLocalParticipant } from "@livekit/components-react";
import { fetchSounds, fetchEmojis, SoundboardSound, CustomEmoji } from "../api";
import { renderMessageText, buildEmojiUrlMap } from "../emojiText";
import { playSoundboardSound } from "../soundboard";
import { useSoundboardVolume } from "../SoundboardVolumeContext";
import SoundboardVolumeControl from "./SoundboardVolumeControl";

interface Props {
  onClose: () => void;
  backendUrl: string;
  authToken: string;
}

/**
 * Painel de USAR o soundboard (grade de sons pra tocar) — aberto a partir
 * da barra de voz. Adicionar/remover som fica nas Configurações
 * (SoundboardManager.tsx), não aqui.
 */
export default function SoundboardPanel({ onClose, backendUrl, authToken }: Props) {
  const { localParticipant } = useLocalParticipant();
  const { volume } = useSoundboardVolume();

  const [sounds, setSounds] = useState<SoundboardSound[]>([]);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSounds(backendUrl, authToken)
      .then((list) => {
        if (!cancelled) setSounds(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar sons");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Pra mostrar o emoji personalizado (ex: "🎺 Buzina" com :buzina:)
    // como imagem em vez do ":codigo:" cru dentro dos quadrados.
    fetchEmojis(backendUrl, authToken)
      .then((list) => {
        if (!cancelled) setCustomEmojis(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [backendUrl, authToken]);

  const emojiByCode = buildEmojiUrlMap(backendUrl, customEmojis);

  async function handlePlay(sound: SoundboardSound) {
    try {
      await playSoundboardSound(`${backendUrl}${sound.url}`, localParticipant, volume);
    } catch (err) {
      console.warn("Erro ao tocar som do soundboard:", err);
    }
  }

  return (
    <div className="soundboard-popover-backdrop" onClick={onClose}>
      <div className="soundboard-popover" onClick={(e) => e.stopPropagation()}>
        <div className="soundboard-popover-header">
          <h3>Soundboard</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <SoundboardVolumeControl />

        {loading ? (
          <p className="device-select-empty">Carregando sons...</p>
        ) : error ? (
          <p className="soundboard-error">{error}</p>
        ) : sounds.length === 0 ? (
          <p className="device-select-empty">
            Nenhum som ainda — adicione um em Configurações → Soundboard.
          </p>
        ) : (
          <div className="soundboard-grid">
            {sounds.map((sound) => (
              <button
                key={sound.id}
                className="soundboard-tile"
                onClick={() => handlePlay(sound)}
                title={`Tocar "${sound.name}"`}
              >
                {renderMessageText(sound.name, emojiByCode)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
