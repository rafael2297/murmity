/**
 * Inicia backend e LiveKit como processos filho do app (via o processo
 * principal do Electron) e espera cada um responder no health-check antes
 * de considerar "pronto".
 *
 * Só funciona dentro do app Electron empacotado — no navegador
 * (`npm run dev`), isEnvElectron() retorna false e quem chama deve usar o
 * fluxo manual antigo (digitar a URL do backend).
 */

interface ElectronAPI {
  isElectron: true;
  listNetworkInterfaces: () => Promise<{ name: string; address: string }[]>;
  startBackend: (env: Record<string, string>) => Promise<{ url: string }>;
  stopBackend: () => Promise<void>;
  startLiveKit: (nodeIp: string) => Promise<void>;
  stopLiveKit: () => Promise<void>;
  onHostLog: (callback: (line: string) => void) => () => void;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  installUpdate: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  canExcludeOwnAudio: () => Promise<boolean>;
  onRequestCloseChoice: (callback: () => void) => () => void;
  respondCloseChoice: (choice: CloseChoice) => void;
  registerMuteShortcut: (accelerator: string | null) => Promise<boolean>;
  onGlobalMuteToggle: (callback: () => void) => () => void;
}

export interface UpdateStatus {
  status: "available" | "downloaded";
  version: string;
}

export type CloseChoice = "minimize" | "quit" | "cancel";

function getElectronAPI(): ElectronAPI | null {
  if (typeof window === "undefined") return null;
  return (window as any).electronAPI ?? null;
}

export function isEnvElectron(): boolean {
  return getElectronAPI() !== null;
}

export async function startBackendSidecar(
  options: { env?: Record<string, string>; onLog?: (line: string) => void } = {}
): Promise<{ url: string }> {
  const api = getElectronAPI();
  if (!api) {
    throw new Error("startBackendSidecar só funciona dentro do app instalado (Electron).");
  }

  let removeListener: (() => void) | null = null;
  if (options.onLog) {
    removeListener = api.onHostLog(options.onLog);
  }

  try {
    return await api.startBackend(options.env ?? {});
  } finally {
    removeListener?.();
  }
}

export async function stopBackendSidecar(): Promise<void> {
  await getElectronAPI()?.stopBackend();
}

export async function startLiveKitSidecar(
  nodeIp: string,
  onLog?: (line: string) => void
): Promise<void> {
  const api = getElectronAPI();
  if (!api) {
    throw new Error("startLiveKitSidecar só funciona dentro do app instalado (Electron).");
  }

  let removeListener: (() => void) | null = null;
  if (onLog) {
    removeListener = api.onHostLog(onLog);
  }

  try {
    await api.startLiveKit(nodeIp);
  } finally {
    removeListener?.();
  }
}

export async function stopLiveKitSidecar(): Promise<void> {
  await getElectronAPI()?.stopLiveKit();
}

/**
 * Escuta os avisos de atualização (ver UpdateBanner.tsx). Fora do
 * Electron (navegador, npm run dev) não faz nada — não existe checagem
 * de atualização fora do app instalado.
 */
export function onUpdateStatus(callback: (status: UpdateStatus) => void): () => void {
  const api = getElectronAPI();
  if (!api) return () => {};
  return api.onUpdateStatus(callback);
}

/**
 * Este PC consegue compartilhar o áudio do sistema SEM o áudio do próprio
 * Murmity? (Windows build 20348+ com Electron 43.4+.) Se não, quem
 * compartilha precisa mutar os outros localmente pra ninguém se ouvir.
 */
export async function canExcludeOwnAudio(): Promise<boolean> {
  try {
    return (await getElectronAPI()?.canExcludeOwnAudio()) ?? false;
  } catch {
    return false;
  }
}

/** Versão instalada do app (ex: "1.9.1"). Fora do Electron devolve null. */
export async function getAppVersion(): Promise<string | null> {
  try {
    return (await getElectronAPI()?.getAppVersion()) ?? null;
  } catch {
    return null;
  }
}

/** Fecha o app e instala a versão já baixada (o instalador reabre sozinho). */
export async function installUpdate(): Promise<void> {
  await getElectronAPI()?.installUpdate();
}

/**
 * Escuta o pedido do processo principal pra perguntar "minimizar ou fechar"
 * quando a pessoa clica no X da janela (ver CloseConfirmModal.tsx). Fora do
 * Electron não faz nada — o botão de fechar é só do sistema operacional no
 * navegador, não tem como interceptar.
 */
export function onRequestCloseChoice(callback: () => void): () => void {
  const api = getElectronAPI();
  if (!api) return () => {};
  return api.onRequestCloseChoice(callback);
}

/** Responde o pedido acima com a escolha feita no modal. */
export function respondCloseChoice(choice: CloseChoice): void {
  getElectronAPI()?.respondCloseChoice(choice);
}

/**
 * Registra (ou troca) o atalho GLOBAL de alternar mudo — funciona mesmo
 * com outro programa em foco (ex: dentro de um jogo), mas só ALTERNA
 * (o Electron não tem como saber quando a tecla é solta fora do próprio
 * app — ver PROJECT_CONTEXT.md). Passar `null` só desregistra.
 *
 * Devolve `false` quando o sistema operacional recusa a combinação (quase
 * sempre porque outro programa já registrou ela primeiro) — quem chama
 * isso deve avisar a pessoa nesse caso, não falhar silenciosamente.
 *
 * Fora do Electron (navegador) sempre devolve `false`: atalho global não
 * existe nesse ambiente.
 */
export async function registerMuteShortcut(accelerator: string | null): Promise<boolean> {
  const api = getElectronAPI();
  if (!api) return false;
  return api.registerMuteShortcut(accelerator);
}

/** Escuta o atalho global disparando (ver registerMuteShortcut acima). Fora do Electron não faz nada. */
export function onGlobalMuteToggle(callback: () => void): () => void {
  const api = getElectronAPI();
  if (!api) return () => {};
  return api.onGlobalMuteToggle(callback);
}
