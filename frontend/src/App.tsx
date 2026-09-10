import { useState } from "react";
import StartScreen from "./components/StartScreen";
import LoginScreen from "./components/LoginScreen";
import Workspace from "./components/Workspace";
import UpdateBanner from "./components/UpdateBanner";
import { UpdateProvider } from "./UpdateContext";
import { SoundboardVolumeProvider } from "./SoundboardVolumeContext";
import { AuthUser } from "./api";
import { isEnvElectron } from "./host";

interface Session {
  backendUrl: string;
  token: string;
  user: AuthUser;
}

// Fora do Electron (navegador, npm run dev), pula direto pro fluxo antigo
// de login manual — a tela de "Hospedar/Entrar" só faz sentido no app
// instalado, onde dá pra rodar o backend/LiveKit como processo filho.
type Screen = "start" | "login";

function loadSession(): Session | null {
  // No Electron, sempre recomeça pela tela inicial — backend/LiveKit são
  // processos filho que não continuam rodando entre uma abertura e outra
  // do app, então "lembrar" que você tinha hospedado antes é enganoso
  // (a sessão salva aponta pra um servidor que não está mais de pé).
  if (isEnvElectron()) return null;

  const raw = localStorage.getItem("session");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession());
  const [screen, setScreen] = useState<Screen>(isEnvElectron() ? "start" : "login");
  const [prefillBackendUrl, setPrefillBackendUrl] = useState<string | undefined>(undefined);

  function handleAuthenticated(params: Session) {
    localStorage.setItem("session", JSON.stringify(params));
    setSession(params);
  }

  function handleLogout() {
    localStorage.removeItem("session");
    setSession(null);
    setScreen(isEnvElectron() ? "start" : "login");
  }

  // UpdateProvider fica UMA vez aqui em cima, fora das telas condicionais
  // — assim o estado de atualização não se perde quando o usuário sai da
  // tela de login/hospedar e entra no Workspace (ver UpdateContext.tsx).
  return (
    <UpdateProvider>
      <SoundboardVolumeProvider>
        {!session ? (
          <div className="app-shell">
            <UpdateBanner />
            <header>
              <h1>🎧 Murmity</h1>
            </header>
            <main>
              {screen === "start" ? (
                <StartScreen
                  onHostReady={(backendUrl) => {
                    setPrefillBackendUrl(backendUrl);
                    setScreen("login");
                  }}
                  onJoinExisting={() => setScreen("login")}
                  onAuthenticated={handleAuthenticated}
                />
              ) : (
                <LoginScreen
                  onAuthenticated={handleAuthenticated}
                  initialBackendUrl={prefillBackendUrl}
                  onBack={isEnvElectron() ? () => setScreen("start") : undefined}
                />
              )}
            </main>
          </div>
        ) : (
          <Workspace
            backendUrl={session.backendUrl}
            authToken={session.token}
            username={session.user.username}
            onLogout={handleLogout}
          />
        )}
      </SoundboardVolumeProvider>
    </UpdateProvider>
  );
}
