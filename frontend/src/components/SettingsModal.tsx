import { useState } from "react";
import { useMediaDeviceSelect } from "@livekit/components-react";
import { X, User, SlidersHorizontal, Music4, Smile, LogOut } from "lucide-react";
import SoundboardManager from "./SoundboardManager";
import SoundboardVolumeControl from "./SoundboardVolumeControl";
import EmojiManager from "./EmojiManager";

interface Props {
  onClose: () => void;
  inCall: boolean;
  username: string;
  backendUrl: string;
  authToken: string;
  onLogout: () => void;
}

function DeviceSelect({ kind, label }: { kind: MediaDeviceKind; label: string }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });

  if (devices.length === 0) {
    return (
      <div className="device-select">
        <label>{label}</label>
        <p className="device-select-empty">Nenhum dispositivo encontrado.</p>
      </div>
    );
  }

  return (
    <div className="device-select">
      <label>{label}</label>
      <select value={activeDeviceId} onChange={(e) => setActiveMediaDevice(e.target.value)}>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Dispositivo ${d.deviceId.slice(0, 6)}`}
          </option>
        ))}
      </select>
    </div>
  );
}

type Tab = "account" | "devices" | "soundboard" | "emojis";

const TABS: { id: Tab; label: string; icon: typeof User }[] = [
  { id: "account", label: "Minha conta", icon: User },
  { id: "devices", label: "Dispositivos", icon: SlidersHorizontal },
  { id: "soundboard", label: "Soundboard", icon: Music4 },
  { id: "emojis", label: "Emojis", icon: Smile },
];

export default function SettingsModal({
  onClose,
  inCall,
  username,
  backendUrl,
  authToken,
  onLogout,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("account");

  function handleLogoutClick() {
    if (inCall) {
      const confirmed = window.confirm(
        "Trocar de nome/servidor vai te desconectar da call de voz agora. Continuar?"
      );
      if (!confirmed) return;
    }
    onClose();
    onLogout();
  }

  const activeLabel = TABS.find((t) => t.id === activeTab)?.label ?? "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <nav className="settings-sidebar">
          <div className="settings-sidebar-title">Configurações</div>

          <div className="settings-tab-list">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`settings-tab-btn ${activeTab === tab.id ? "active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="settings-sidebar-divider" />

          <button className="settings-tab-btn settings-logout-btn" onClick={handleLogoutClick}>
            <LogOut size={16} />
            <span>Trocar de nome/servidor</span>
          </button>
        </nav>

        <div className="settings-content">
          <div className="settings-content-header">
            <h3>{activeLabel}</h3>
            <button className="icon-btn" onClick={onClose} title="Fechar">
              <X size={18} />
            </button>
          </div>

          <div className="settings-content-body">
            {activeTab === "account" && (
              <p className="account-info">
                Logado como <strong>{username}</strong>
                <br />
                Servidor: {backendUrl}
              </p>
            )}

            {activeTab === "devices" &&
              (inCall ? (
                <>
                  <DeviceSelect kind="audioinput" label="Microfone" />
                  <DeviceSelect kind="videoinput" label="Câmera" />
                  <DeviceSelect kind="audiooutput" label="Saída de áudio (alto-falante)" />
                  <p className="device-select-note">
                    Saída de áudio pode não funcionar no Firefox (suporte limitado do navegador).
                  </p>
                </>
              ) : (
                <p className="device-select-empty">
                  Entre no canal de voz pra poder trocar microfone/câmera.
                </p>
              ))}

            {activeTab === "soundboard" && (
              <>
                <div className="soundboard-volume-label">
                  Volume dos sons do soundboard (seus e de outras pessoas na call)
                </div>
                <SoundboardVolumeControl />
                <hr className="settings-divider" />
                <SoundboardManager backendUrl={backendUrl} authToken={authToken} username={username} />
              </>
            )}

            {activeTab === "emojis" && (
              <EmojiManager backendUrl={backendUrl} authToken={authToken} username={username} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
