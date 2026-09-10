export interface SavedConnection {
  id: string;
  backendUrl: string;
  username: string;
  lastUsedAt: number;
}

const STORAGE_KEY = "savedConnections";
// Não precisa de mais que isso pra um grupo pequeno de amigos — mantém a
// lista curta e sempre com as mais usadas por cima.
const MAX_SAVED = 6;

function makeId(backendUrl: string, username: string): string {
  return `${backendUrl}::${username}`;
}

/** Conexões salvas, das mais recentes pras mais antigas. */
export function getSavedConnections(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as SavedConnection[];
    return [...list].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  } catch {
    return [];
  }
}

/**
 * Salva uma conexão nas "recentes" (ou atualiza a data de uso, se já
 * existir a mesma combinação de servidor + nome). Mantém só as
 * MAX_SAVED usadas mais recentemente — as mais antigas somem sozinhas.
 */
export function saveConnection(backendUrl: string, username: string): void {
  const id = makeId(backendUrl, username);
  const rest = getSavedConnections().filter((c) => c.id !== id);
  const updated: SavedConnection[] = [
    { id, backendUrl, username, lastUsedAt: Date.now() },
    ...rest,
  ].slice(0, MAX_SAVED);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function removeConnection(id: string): void {
  const updated = getSavedConnections().filter((c) => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
