import { useState } from "react";
import { identify, AuthUser } from "../api";
import { saveConnection } from "../connections";
import RecentConnections from "./RecentConnections";

interface Props {
  onAuthenticated: (params: { backendUrl: string; token: string; user: AuthUser }) => void;
  initialBackendUrl?: string;
  onBack?: () => void;
}

const DEFAULT_BACKEND_URL = "http://localhost:3000";

export default function LoginScreen({ onAuthenticated, initialBackendUrl, onBack }: Props) {
  const [backendUrl, setBackendUrl] = useState(
    initialBackendUrl || localStorage.getItem("backendUrl") || DEFAULT_BACKEND_URL
  );
  const [username, setUsername] = useState(localStorage.getItem("lastUsername") || "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanUrl = backendUrl.trim().replace(/\/$/, "");
    const cleanUsername = username.trim();
    if (!cleanUrl || cleanUsername.length < 2) {
      setError("Preencha a URL do backend e um nome com pelo menos 2 caracteres.");
      return;
    }

    setLoading(true);
    try {
      const result = await identify(cleanUrl, cleanUsername);
      localStorage.setItem("backendUrl", cleanUrl);
      localStorage.setItem("lastUsername", cleanUsername);
      saveConnection(cleanUrl, cleanUsername);
      onAuthenticated({ backendUrl: cleanUrl, token: result.token, user: result.user });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível conectar ao backend.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <RecentConnections onAuthenticated={onAuthenticated} />

      <form onSubmit={handleSubmit}>
        <h2>Entrar</h2>

        <label>URL do backend</label>
        <input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />

        <label>Seu nome</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Como os outros vão te ver"
          autoFocus
        />

        <div className="auth-actions">
          <button type="submit" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </div>

        {onBack && (
          <button type="button" className="link-btn" onClick={onBack}>
            ← Voltar
          </button>
        )}

        {error && <p className="auth-error">{error}</p>}
      </form>
    </div>
  );
}
