import { useEffect, useState } from "react";
import { Server, LogIn } from "lucide-react";
import { startBackendSidecar, startLiveKitSidecar, isEnvElectron } from "../host";
import { listNetworkInterfaces, pickBestInterface, NetworkInterfaceOption } from "../network";
import { AuthUser } from "../api";
import RecentConnections from "./RecentConnections";

interface Props {
  onHostReady: (backendUrl: string) => void;
  onJoinExisting: () => void;
  onAuthenticated: (params: { backendUrl: string; token: string; user: AuthUser }) => void;
}

type Step = "choose" | "network" | "starting";

export default function StartScreen({ onHostReady, onJoinExisting, onAuthenticated }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [interfaces, setInterfaces] = useState<NetworkInterfaceOption[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [readyAddress, setReadyAddress] = useState<string | null>(null);

  const canHost = isEnvElectron();

  async function handleClickHost() {
    setError(null);
    setStep("network");
    try {
      const found = await listNetworkInterfaces();
      setInterfaces(found);
      const best = pickBestInterface(found);
      setSelectedAddress(best?.address ?? "127.0.0.1");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInterfaces([]);
      setSelectedAddress("127.0.0.1");
    }
  }

  async function handleConfirmNetwork() {
    setError(null);
    setStep("starting");
    setLog(["Iniciando LiveKit..."]);
    try {
      await startLiveKitSidecar(selectedAddress, (line) =>
        setLog((prev) => [...prev.slice(-20), line])
      );
      setLog((prev) => [...prev, "LiveKit pronto ✓", "Iniciando backend..."]);

      const { url } = await startBackendSidecar({
        env: {
          // O backend devolve essa URL pros clientes conectarem no LiveKit.
          LIVEKIT_URL: `ws://${selectedAddress}:7880`,
        },
        onLog: (line) => setLog((prev) => [...prev.slice(-20), line]),
      });
      setLog((prev) => [...prev, "Backend pronto ✓"]);
      setReadyAddress(selectedAddress);
      onHostReady(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("network");
    }
  }

  return (
    <div className="start-screen">
      <h2>Murmity</h2>

      {step === "choose" && (
        <>
          <p className="start-subtitle">Escolha como você quer usar o app</p>
          <div className="start-options">
            <button className="start-option" onClick={handleClickHost} disabled={!canHost}>
              <Server size={28} />
              <div>
                <div className="start-option-title">Hospedar servidor</div>
                <div className="start-option-desc">
                  Inicia o backend nesta máquina — seus amigos conectam em você.
                </div>
              </div>
            </button>

            <button className="start-option" onClick={onJoinExisting}>
              <LogIn size={28} />
              <div>
                <div className="start-option-title">Entrar em servidor</div>
                <div className="start-option-desc">
                  Conectar num servidor que um amigo já está hospedando.
                </div>
              </div>
            </button>
          </div>
          {!canHost && (
            <p className="start-note">
              "Hospedar servidor" só funciona no app instalado — no navegador, use "Entrar
              em servidor" com a URL do backend rodando via Docker/script.
            </p>
          )}

          <RecentConnections onAuthenticated={onAuthenticated} />
        </>
      )}

      {step === "network" && (
        <>
          <p className="start-subtitle">
            Qual rede seus amigos vão usar pra se conectar em você?
          </p>

          {interfaces.length === 0 ? (
            <p className="start-note">
              Nenhuma interface de rede detectada além da local. Se você usa Tailscale ou Radmin
              VPN, confira se estão conectados antes de continuar.
            </p>
          ) : (
            <div className="network-list">
              {interfaces.map((iface) => (
                <label key={iface.address} className="network-option">
                  <input
                    type="radio"
                    name="network"
                    value={iface.address}
                    checked={selectedAddress === iface.address}
                    onChange={() => setSelectedAddress(iface.address)}
                  />
                  <div>
                    <div className="network-option-label">{iface.label}</div>
                    <div className="network-option-detail">
                      {iface.name} — {iface.address}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}

          <div className="auth-actions">
            <button onClick={handleConfirmNetwork} disabled={!selectedAddress}>
              Continuar com {selectedAddress}
            </button>
            <button className="secondary" onClick={() => setStep("choose")}>
              Voltar
            </button>
          </div>
        </>
      )}

      {step === "starting" && (
        <>
          <p className="start-subtitle">Iniciando servidor...</p>
          {readyAddress && (
            <p className="start-note">
              Pronto! Backend e LiveKit rodando. Compartilhe este endereço com seus amigos:{" "}
              <strong>{readyAddress}:3000</strong> (eles usam isso como "URL do backend").
            </p>
          )}
        </>
      )}

      {(log.length > 0 || error) && (
        <div className="start-log">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
