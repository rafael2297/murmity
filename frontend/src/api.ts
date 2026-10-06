export interface AuthUser {
  username: string;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

export interface JoinTokenResult {
  token: string;
  url: string;
  identity: string;
  room: string;
}

export interface Channel {
  id: string;
  name: string;
  type: "text" | "voice";
  position: number;
  createdAt: number;
}

export interface VoiceParticipant {
  identity: string;
}

export interface SoundboardSound {
  id: string;
  name: string;
  url: string;
  addedBy: string;
  createdAt: number;
}

export interface CustomEmoji {
  id: string;
  code: string;
  url: string;
  addedBy: string;
  createdAt: number;
}

export interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

export interface UploadedAttachment {
  url: string;
  type: "image" | "audio" | "video" | "file";
  name: string;
}

export type LinkPreview =
  | {
      type: "youtube";
      videoId: string;
      title: string;
      authorName: string;
      thumbnailUrl: string;
    }
  | {
      type: "generic";
      url: string;
      title: string;
      description: string;
      imageUrl: string | null;
      siteName: string;
    };

export async function fetchVoiceParticipants(
  backendUrl: string,
  authToken: string,
  roomName: string
): Promise<VoiceParticipant[]> {
  const res = await fetch(`${backendUrl}/rooms/${encodeURIComponent(roomName)}/participants`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = await parseJsonOrThrow(res);
  return data.participants;
}

async function parseJsonOrThrow(res: Response): Promise<any> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // resposta sem corpo JSON (ex: erro de rede tratado antes de chegar aqui)
  }
  if (!res.ok) {
    throw new Error(data?.error || `Erro ${res.status}`);
  }
  return data;
}

/**
 * Substitui login/cadastro: só um nome, sem senha nem conta persistente.
 */
export async function identify(backendUrl: string, username: string): Promise<AuthResult> {
  const res = await fetch(`${backendUrl}/auth/identify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  return parseJsonOrThrow(res);
}

export async function fetchJoinToken(
  backendUrl: string,
  authToken: string,
  roomName: string
): Promise<JoinTokenResult> {
  const res = await fetch(`${backendUrl}/rooms/${encodeURIComponent(roomName)}/join-token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
  });
  return parseJsonOrThrow(res);
}

/** Lista todos os canais (texto e voz), na ordem de exibição. */
export async function fetchChannels(backendUrl: string, authToken: string): Promise<Channel[]> {
  const res = await fetch(`${backendUrl}/channels`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = await parseJsonOrThrow(res);
  return data.channels;
}

/**
 * Cria um canal novo (texto ou voz). Qualquer pessoa pode criar — sem
 * cargo/permissão, igual ao resto do app. A lista de canais de todo
 * mundo é atualizada via WebSocket (evento "channel_created"), não pelo
 * retorno desta função.
 */
export async function createChannel(
  backendUrl: string,
  authToken: string,
  name: string,
  type: "text" | "voice"
): Promise<Channel> {
  const res = await fetch(`${backendUrl}/channels`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, type }),
  });
  const data = await parseJsonOrThrow(res);
  return data.channel;
}

/**
 * Apaga um canal. O servidor recusa (erro 400) se for o último canal
 * daquele tipo — precisa sempre sobrar pelo menos um de texto e um de
 * voz.
 */
export async function deleteChannel(backendUrl: string, authToken: string, id: string): Promise<void> {
  const res = await fetch(`${backendUrl}/channels/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authToken}` },
  });
  await parseJsonOrThrow(res);
}

/** Lista os sons do soundboard disponíveis (compartilhados entre todos). */
export async function fetchSounds(
  backendUrl: string,
  authToken: string
): Promise<SoundboardSound[]> {
  const res = await fetch(`${backendUrl}/sounds`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = await parseJsonOrThrow(res);
  return data.sounds;
}

/**
 * Envia um novo som pro soundboard. Sem limite de duração ou quantidade
 * — só um teto de tamanho de arquivo do lado do backend (segurança, não
 * é uma restrição de feature).
 */
export async function uploadSound(
  backendUrl: string,
  authToken: string,
  name: string,
  file: File
): Promise<SoundboardSound> {
  const params = new URLSearchParams({ name, filename: file.name });
  const res = await fetch(`${backendUrl}/sounds?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  const data = await parseJsonOrThrow(res);
  return data.sound;
}

export async function deleteSound(backendUrl: string, authToken: string, id: string): Promise<void> {
  const res = await fetch(`${backendUrl}/sounds/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authToken}` },
  });
  await parseJsonOrThrow(res);
}

/** Lista os emojis personalizados disponíveis (compartilhados entre todos). */
export async function fetchEmojis(backendUrl: string, authToken: string): Promise<CustomEmoji[]> {
  const res = await fetch(`${backendUrl}/emojis`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = await parseJsonOrThrow(res);
  return data.emojis;
}

/**
 * Envia um novo emoji personalizado. `code` é o atalho usado no chat
 * (ex: "buzina" vira :buzina:) — precisa ser único. Sem limite de
 * quantidade de emojis, só um teto de tamanho de arquivo no backend.
 */
export async function uploadEmoji(
  backendUrl: string,
  authToken: string,
  code: string,
  file: File
): Promise<CustomEmoji> {
  const params = new URLSearchParams({ code, filename: file.name });
  const res = await fetch(`${backendUrl}/emojis?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  const data = await parseJsonOrThrow(res);
  return data.emoji;
}

export async function deleteEmoji(backendUrl: string, authToken: string, id: string): Promise<void> {
  const res = await fetch(`${backendUrl}/emojis/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authToken}` },
  });
  await parseJsonOrThrow(res);
}

/** GIFs em alta — mostrados quando o seletor de GIF abre sem busca ainda. */
export async function fetchTrendingGifs(backendUrl: string, authToken: string): Promise<GifResult[]> {
  const res = await fetch(`${backendUrl}/gifs/trending`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = await parseJsonOrThrow(res);
  return data.gifs;
}

export async function searchGifs(
  backendUrl: string,
  authToken: string,
  query: string
): Promise<GifResult[]> {
  const res = await fetch(`${backendUrl}/gifs/search?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = await parseJsonOrThrow(res);
  return data.gifs;
}

/**
 * Envia uma imagem ou áudio pra ser anexado numa mensagem de chat. O
 * fluxo é: faz esse upload primeiro, pega a URL de volta, e só então
 * manda a mensagem de chat de verdade (via WebSocket) com essa URL.
 */
export async function uploadAttachment(
  backendUrl: string,
  authToken: string,
  kind: "image" | "audio" | "video" | "file",
  file: File
): Promise<UploadedAttachment> {
  const params = new URLSearchParams({ kind, filename: file.name });
  const res = await fetch(`${backendUrl}/attachments?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  return parseJsonOrThrow(res);
}

/**
 * Busca o preview de um link (YouTube via oEmbed, qualquer outro site via
 * Open Graph — ver backend/src/linkpreview.ts). Retorna `null` em vez de
 * lançar erro quando não tem preview disponível pra esse link — nesses
 * casos o link continua funcionando normal, só sem card, então não faz
 * sentido tratar isso como uma falha de verdade.
 */
export async function fetchLinkPreview(
  backendUrl: string,
  authToken: string,
  url: string
): Promise<LinkPreview | null> {
  try {
    const res = await fetch(`${backendUrl}/link-preview?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
