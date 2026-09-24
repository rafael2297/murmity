import { useState } from "react";
import { Hash, Volume2, Settings, Plus, Trash2 } from "lucide-react";
import { useChatConnection } from "../ChatConnectionContext";
import { useConfirm } from "../ConfirmContext";
import { Channel } from "../api";
import VoiceUserBar from "./VoiceUserBar";
import VoiceMicControl from "./VoiceMicControl";
import VoiceDeafenControl from "./VoiceDeafenControl";
import VoiceParticipants from "./VoiceParticipants";
import VoiceChannelPreview from "./VoiceChannelPreview";
import SettingsModal from "./SettingsModal";
import CreateChannelModal from "./CreateChannelModal";

interface Props {
  username: string;
  backendUrl: string;
  authToken: string;
  inCall: boolean;
  // ID do canal de voz em que você está agora (= joinInfo.room no
  // Workspace), ou null se não estiver em nenhuma call. Guardado por ID
  // (não por nome) porque dois canais de voz PODEM ter o mesmo nome.
  activeVoiceChannelId: string | null;
  joining: boolean;
  mainView: "chat" | "call";
  onJoinVoice: (channelId: string) => void;
  onSelectChat: () => void;
  onSelectCall: () => void;
  onLogout: () => void;
}

export default function ChannelSidebar({
  username,
  backendUrl,
  authToken,
  inCall,
  activeVoiceChannelId,
  joining,
  mainView,
  onJoinVoice,
  onSelectChat,
  onSelectCall,
  onLogout,
}: Props) {
  const [showSettings, setShowSettings] = useState(false);
  // Guarda qual TIPO de canal o "+" abriu (o modal já nasce com o tipo
  // certo pré-selecionado, sem precisar perguntar de novo lá dentro).
  const [createModalType, setCreateModalType] = useState<"text" | "voice" | null>(null);
  const { channels, currentTextChannelId, switchTextChannel, deleteChannel } = useChatConnection();
  const { confirm, notifyError } = useConfirm();

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  function handleTextClick(channel: Channel) {
    switchTextChannel(channel.id);
    onSelectChat();
  }

  function handleVoiceClick(channel: Channel) {
    if (inCall && activeVoiceChannelId === channel.id) {
      onSelectCall();
    } else {
      // Já em outra call? Isso troca de sala sem precisar desligar antes
      // — o <LiveKitRoom> do Workspace reconecta sozinho quando o token
      // muda (ele já observa esse prop).
      onJoinVoice(channel.id);
    }
  }

  async function handleDeleteChannel(e: React.MouseEvent, channel: Channel) {
    e.stopPropagation(); // não dispara o clique do canal por baixo
    const kind = channel.type === "text" ? "de texto" : "de voz";
    const ok = await confirm({
      title: "Apagar canal",
      message: `Apagar o canal ${kind} "${channel.name}"? Isso não pode ser desfeito.`,
      confirmLabel: "Apagar",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteChannel(channel.id);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Erro ao apagar canal");
    }
  }

  return (
    <div className="channel-sidebar">
      <div className="channel-sidebar-header">Murmity</div>

      <div className="channel-list">
        <div className="channel-category-row">
          <div className="channel-category">Canais de texto</div>
          <button
            className="icon-btn small channel-add-btn"
            onClick={() => setCreateModalType("text")}
            title="Criar canal de texto"
          >
            <Plus size={14} />
          </button>
        </div>
        {textChannels.map((channel) => (
          <div key={channel.id} className="channel-item-row">
            <div
              className={`channel-item clickable ${
                mainView === "chat" && currentTextChannelId === channel.id ? "active" : ""
              }`}
              onClick={() => handleTextClick(channel)}
            >
              <Hash size={18} className="icon" /> {channel.name}
            </div>
            <button
              className="icon-btn small channel-delete-btn"
              onClick={(e) => handleDeleteChannel(e, channel)}
              title="Apagar canal"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}

        <div className="channel-category-row">
          <div className="channel-category">Canais de voz</div>
          <button
            className="icon-btn small channel-add-btn"
            onClick={() => setCreateModalType("voice")}
            title="Criar canal de voz"
          >
            <Plus size={14} />
          </button>
        </div>
        {voiceChannels.map((channel) => {
          const isActive = inCall && activeVoiceChannelId === channel.id;
          return (
            <div key={channel.id}>
              <div className="channel-item-row">
                <div
                  className={`channel-item clickable ${isActive && mainView === "call" ? "active" : ""} ${
                    isActive && mainView !== "call" ? "in-call" : ""
                  }`}
                  onClick={() => handleVoiceClick(channel)}
                >
                  <Volume2 size={18} className="icon" /> {channel.name}
                  {joining && <span className="channel-joining">entrando...</span>}
                </div>
                <button
                  className="icon-btn small channel-delete-btn"
                  onClick={(e) => handleDeleteChannel(e, channel)}
                  title="Apagar canal"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {isActive ? (
                <VoiceParticipants />
              ) : (
                <VoiceChannelPreview backendUrl={backendUrl} authToken={authToken} roomName={channel.id} />
              )}
            </div>
          );
        })}
      </div>

      {inCall && (
        <VoiceUserBar
          backendUrl={backendUrl}
          authToken={authToken}
          channelName={voiceChannels.find((c) => c.id === activeVoiceChannelId)?.name ?? ""}
        />
      )}

      <div className="sidebar-bottom">
        <div className="user-avatar">{username.slice(0, 2).toUpperCase()}</div>
        <div className="user-info">
          <div className="user-name">{username}</div>
          <div className="user-status">{inCall ? "Em voz" : "Online"}</div>
        </div>
        <div className="sidebar-bottom-actions">
          {inCall && <VoiceMicControl />}
          {inCall && <VoiceDeafenControl />}
          <button className="icon-btn" title="Configurações" onClick={() => setShowSettings(true)}>
            <Settings size={16} />
          </button>
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          inCall={inCall}
          username={username}
          backendUrl={backendUrl}
          authToken={authToken}
          onLogout={onLogout}
        />
      )}

      {createModalType && (
        <CreateChannelModal type={createModalType} onClose={() => setCreateModalType(null)} />
      )}
    </div>
  );
}
