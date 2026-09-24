import { Hash, Users } from "lucide-react";
import ChatPanel from "./ChatPanel";
import CallView from "./CallView";
import UpdateBadge from "./UpdateBadge";
import { useChatConnection } from "../ChatConnectionContext";

interface Props {
  username: string;
  inCall: boolean;
  activeVoiceChannelId: string | null;
  view: "chat" | "call";
  showMembers: boolean;
  onToggleMembers: () => void;
  backendUrl: string;
  authToken: string;
}

export default function MainContent({
  username,
  inCall,
  activeVoiceChannelId,
  view,
  showMembers,
  onToggleMembers,
  backendUrl,
  authToken,
}: Props) {
  const { channels, currentTextChannelId } = useChatConnection();
  const textChannelName = channels.find((c) => c.id === currentTextChannelId)?.name ?? "";
  const voiceChannelName = channels.find((c) => c.id === activeVoiceChannelId)?.name ?? "";

  if (view === "call" && inCall) {
    return (
      <CallView
        username={username}
        voiceChannelName={voiceChannelName}
        showMembers={showMembers}
        onToggleMembers={onToggleMembers}
        backendUrl={backendUrl}
        authToken={authToken}
      />
    );
  }

  return (
    <div className="main-content">
      <div className="main-header">
        <Hash size={18} className="main-header-icon" />
        <span>{textChannelName}</span>
        <UpdateBadge />
        <button
          className={`icon-btn member-toggle ${showMembers ? "on" : ""}`}
          onClick={onToggleMembers}
          title={showMembers ? "Esconder lista de membros" : "Mostrar lista de membros"}
          aria-label={showMembers ? "Esconder lista de membros" : "Mostrar lista de membros"}
        >
          <Users size={18} />
        </button>
      </div>
      <ChatPanel username={username} backendUrl={backendUrl} authToken={authToken} />
    </div>
  );
}
