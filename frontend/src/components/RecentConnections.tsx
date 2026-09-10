import { useState } from "react";
import { X } from "lucide-react";
import { identify, AuthUser } from "../api";
import { getSavedConnections, removeConnection, SavedConnection } from "../connections";

interface Props {
  onAuthenticated: (params: { backendUrl: string; token: string; user: AuthUser }) => void;
}

/**
 * Lista de conexões salvas (servidor + nome usado da última vez) — clicar
 * numa delas entra direto, sem precisar digitar nada de novo. Usado tanto
 * na tela inicial (pra entrar assim que o app abre) quanto na tela de
 * login manual. Não aparece nada se a lista estiver vazia.
 */
export default function RecentConnections({ onAuthenticated }: Props) {
  const [connections, setConnections] = useState<SavedConnection[]>(getSavedConnections());
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (connections.length === 0) return null;

  async function handleClick(conn: SavedConnection) {
    setError(null);
    setConnectingId(conn.id);
    try {
      const result = await identify(conn.backendUrl, conn.username);
      onAuthenticated({ backendUrl: conn.backendUrl, token: result.token, user: result.user });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível conectar nesse servidor.");
      setConnectingId(null);
    }
  }

  function handleRemove(id: string) {
    removeConnection(id);
    setConnections(getSavedConnections());
  }

  return (
    <div className="recent-connections">
      <div className="recent-connections-title">Conexões recentes</div>
      <div className="recent-connections-list">
        {connections.map((conn) => (
          <div key={conn.id} className="recent-connection-item">
            <button
              className="recent-connection-main"
              onClick={() => handleClick(conn)}
              disabled={connectingId !== null}
            >
              <div className="recent-connection-username">{conn.username}</div>
              <div className="recent-connection-url">{conn.backendUrl}</div>
            </button>
            {connectingId === conn.id ? (
              <span className="recent-connection-status">Entrando...</span>
            ) : (
              <button
                className="icon-btn small muted"
                onClick={() => handleRemove(conn.id)}
                title="Remover dessa lista"
                disabled={connectingId !== null}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
