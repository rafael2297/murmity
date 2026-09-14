import { useState } from "react";
import { Hash, Volume2, Settings } from "lucide-react";
import VoiceUserBar from "./VoiceUserBar";
import VoiceMicControl from "./VoiceMicControl";
import VoiceDeafenControl from "./VoiceDeafenControl";
import VoiceParticipants from "./VoiceParticipants";
import VoiceChannelPreview from "./VoiceChannelPreview";
import SettingsModal from "./SettingsModal";

const VOICE_ROOM_NAME = "geral";

interface Props {
  username: string;
  backendUrl: string;
  authToken: string;
  inCall: boolean;
  joining: boolean;
  mainView: "chat" | "call";
  onJoinVoice: () => void;
  onSelectChat: () => void;
  onSelectCall: () => void;
  onLogout: () => void;
}

export default function ChannelSidebar({
  username,
  backendUrl,
  authToken,
  inCall,
  joining,
  mainView,
  onJoinVoice,
  onSelectChat,
  onSelectCall,
  onLogout,
}: Props) {
  const [showSettings, setShowSettings] = useState(false);

  function handleVoiceClick() {
    if (inCall) {
      onSelectCall();
    } else {
      onJoinVoice();
    }
  }

  return (
    <div className="channel-sidebar">
      <div className="channel-sidebar-header">Murmity</div>

      <div className="channel-list">
        <div className="channel-category">Canais de texto</div>
        <div
          className={`channel-item clickable ${mainView === "chat" ? "active" : ""}`}
          onClick={onSelectChat}
        >
          <Hash size={18} className="icon" /> geral
        </div>

        <div className="channel-category">Canais de voz</div>
        <div
          className={`channel-item clickable ${inCall && mainView === "call" ? "active" : ""} ${
            inCall && mainView !== "call" ? "in-call" : ""
          }`}
          onClick={handleVoiceClick}
        >
          <Volume2 size={18} className="icon" /> geral
          {joining && <span className="channel-joining">entrando...</span>}
        </div>
        {inCall ? (
          <VoiceParticipants />
        ) : (
          <VoiceChannelPreview backendUrl={backendUrl} authToken={authToken} roomName={VOICE_ROOM_NAME} />
        )}

      </div>

      {inCall && <VoiceUserBar backendUrl={backendUrl} authToken={authToken} />}

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
    </div>
  );
}
