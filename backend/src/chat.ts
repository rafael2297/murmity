import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { IncomingMessage } from "http";
import { db } from "./db";

const JWT_SECRET = process.env.JWT_SECRET as string;

// Mensagens persistem em SQLite (backend/data/chat.db) — sobrevivem a
// reinício do backend. Cada canal de texto mantém só as últimas
// HISTORY_CAP mensagens DELE (a poda é por canal, não global — ver
// pruneStmt — senão um canal "barulhento" apagaria o histórico dos
// outros). Grupo pequeno, não precisa de paginação/arquivamento ainda.
const HISTORY_LIMIT = 50; // quantas mensagens mandar pro cliente ao trocar de canal
const HISTORY_CAP = 500; // quantas mensagens manter no banco, por canal
const MAX_TEXT_LENGTH = 2000;

// Anexo é opcional e pode vir SOZINHO (sem texto, ex: mandou só um GIF)
// ou junto com texto (ex: legenda + imagem). "gif" é uma URL externa
// (Klipy); "image"/"audio"/"video"/"file" apontam pro nosso próprio
// /attachments/files ("file" = qualquer arquivo, mostrado como download).
type AttachmentType = "image" | "audio" | "video" | "file" | "gif";
const ALLOWED_ATTACHMENT_TYPES: AttachmentType[] = ["image", "audio", "video", "file", "gif"];

interface ChatMessage {
  id: string;
  channelId: string;
  username: string;
  text: string;
  timestamp: number;
  attachmentUrl?: string | null;
  attachmentType?: AttachmentType | null;
  attachmentName?: string | null;
  editedAt?: number | null;
  replyToId?: string | null;
  reactions: MessageReaction[];
}

// Uma entrada por emoji, com a lista de quem reagiu com ele — dá pra
// mostrar a contagem (usernames.length) e o tooltip "fulano, ciclano" sem
// precisar de outra ida ao servidor.
interface MessageReaction {
  emoji: string;
  usernames: string[];
}

const MAX_REACTION_LENGTH = 40; // cobre tanto emoji nativo (poucos bytes) quanto ":codigo_bem_longo:"

const insertStmt = db.prepare(
  `INSERT INTO messages (id, channel_id, username, text, timestamp, attachment_url, attachment_type, attachment_name, reply_to_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const historyStmt = db.prepare(
  `SELECT id, channel_id, username, text, timestamp, attachment_url, attachment_type, attachment_name, edited_at, reply_to_id
   FROM messages WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?`
);
// Poda POR CANAL: mantém só as últimas HISTORY_CAP mensagens de cada
// canal, sem mexer nas dos outros.
const pruneStmt = db.prepare(
  `DELETE FROM messages WHERE channel_id = ? AND id NOT IN (
     SELECT id FROM messages WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?
   )`
);
const getByIdStmt = db.prepare("SELECT * FROM messages WHERE id = ?");
const updateTextStmt = db.prepare("UPDATE messages SET text = ?, edited_at = ? WHERE id = ?");
const deleteByIdStmt = db.prepare("DELETE FROM messages WHERE id = ?");
const channelExistsStmt = db.prepare("SELECT type FROM channels WHERE id = ?");

const reactionsForChannelStmt = db.prepare(
  `SELECT r.message_id, r.emoji, r.username FROM reactions r
   JOIN messages m ON m.id = r.message_id
   WHERE m.channel_id = ?
   ORDER BY r.created_at ASC`
);
const reactionsForMessageStmt = db.prepare(
  "SELECT emoji, username FROM reactions WHERE message_id = ? ORDER BY created_at ASC"
);
const reactionExistsStmt = db.prepare(
  "SELECT 1 FROM reactions WHERE message_id = ? AND username = ? AND emoji = ?"
);
const addReactionStmt = db.prepare(
  "INSERT INTO reactions (message_id, username, emoji, created_at) VALUES (?, ?, ?, ?)"
);
const removeReactionStmt = db.prepare(
  "DELETE FROM reactions WHERE message_id = ? AND username = ? AND emoji = ?"
);
const deleteReactionsByMessageStmt = db.prepare("DELETE FROM reactions WHERE message_id = ?");
// Roda junto da poda de histórico (handleSend) — sem isso, reação de uma
// mensagem que já saiu do histórico (HISTORY_CAP) ficaria pra sempre no
// banco, órfã, sem mensagem nenhuma dona dela.
const pruneOrphanReactionsStmt = db.prepare("DELETE FROM reactions WHERE message_id NOT IN (SELECT id FROM messages)");

interface MessageRow {
  id: string;
  channel_id: string;
  username: string;
  text: string;
  timestamp: number;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_name: string | null;
  edited_at: number | null;
  reply_to_id: string | null;
}

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    username: row.username,
    text: row.text,
    timestamp: row.timestamp,
    attachmentUrl: row.attachment_url,
    attachmentType: row.attachment_type as AttachmentType | null,
    attachmentName: row.attachment_name,
    editedAt: row.edited_at,
    replyToId: row.reply_to_id,
    reactions: [], // preenchido depois, em getHistory (aqui fica vazio de propósito)
  };
}

/** Agrupa linhas soltas (message_id, emoji, username) em [{emoji, usernames}]. */
function groupReactionRows(rows: { emoji: string; username: string }[]): MessageReaction[] {
  const byEmoji = new Map<string, string[]>();
  for (const row of rows) {
    if (!byEmoji.has(row.emoji)) byEmoji.set(row.emoji, []);
    byEmoji.get(row.emoji)!.push(row.username);
  }
  return Array.from(byEmoji.entries()).map(([emoji, usernames]) => ({ emoji, usernames }));
}

function getHistory(channelId: string): ChatMessage[] {
  const rows = historyStmt.all(channelId, HISTORY_LIMIT) as unknown as MessageRow[];
  const messages = rows.reverse().map(rowToMessage); // banco devolve mais recente primeiro, chat quer cronológico

  // Uma query só pra todas as reações DESSE canal, em vez de uma por
  // mensagem.
  const reactionRows = reactionsForChannelStmt.all(channelId) as unknown as {
    message_id: string;
    emoji: string;
    username: string;
  }[];
  const rowsByMessage = new Map<string, { emoji: string; username: string }[]>();
  for (const r of reactionRows) {
    if (!rowsByMessage.has(r.message_id)) rowsByMessage.set(r.message_id, []);
    rowsByMessage.get(r.message_id)!.push(r);
  }
  for (const m of messages) {
    m.reactions = groupReactionRows(rowsByMessage.get(m.id) ?? []);
  }
  return messages;
}

const clients = new Set<WebSocket>();
// Canal de texto que cada socket está "olhando" agora — é o que decide
// pra quem uma mensagem nova é entregue em tempo real (ver
// broadcastToChannel). Não existe até a pessoa mandar "join_channel" (a
// conexão em si não pressupõe nenhum canal específico, só presença
// global). Guardado fora do objeto WebSocket (em vez de "as any") pra não
// perder o tipo em nenhum outro lugar do arquivo.
const channelBySocket = new Map<WebSocket, string>();

// Rastreia quem está "online" (com o app aberto e conectado no chat) —
// independente de estar na call de voz ou em qual canal de texto está
// olhando. Usa identity -> conjunto de sockets, pra funcionar direito se
// a mesma pessoa abrir 2 abas/janelas (só sai da lista quando a ÚLTIMA
// conexão dela fechar).
const onlineByIdentity = new Map<string, Set<WebSocket>>();

function broadcastPresence() {
  const payload = JSON.stringify({ type: "presence", online: Array.from(onlineByIdentity.keys()) });
  broadcast(payload);
}

/** Manda pra TODO MUNDO conectado, não importa o canal — presença, canal criado/apagado, edição/remoção/reação de mensagem. */
function broadcast(payload: string) {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/** Manda só pra quem está com aquele canal de texto aberto agora (ver channelBySocket) — usado pra mensagem nova. */
function broadcastToChannel(channelId: string, payload: string) {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN && channelBySocket.get(client) === channelId) {
      client.send(payload);
    }
  }
}

/**
 * Usado por channels.ts pra avisar todo mundo quando um canal é criado ou
 * apagado — channels.ts não tem acesso direto aos sockets (só chat.ts
 * tem), então expõe essa função em vez de duplicar a lista de clientes.
 */
export function broadcastChatEvent(payload: string) {
  broadcast(payload);
}

function verifyToken(req: IncomingMessage): { username: string } | null {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    if (!token) return null;
    return jwt.verify(token, JWT_SECRET) as { username: string };
  } catch {
    return null;
  }
}

export function setupChat(wss: WebSocketServer) {
  wss.on("connection", (ws, req) => {
    const auth = verifyToken(req);
    if (!auth) {
      ws.close(4001, "token inválido ou ausente");
      return;
    }
    const username = auth.username;

    clients.add(ws);

    if (!onlineByIdentity.has(username)) {
      onlineByIdentity.set(username, new Set());
    }
    onlineByIdentity.get(username)!.add(ws);
    broadcastPresence();

    // Não manda histórico de nenhum canal aqui — a conexão em si é só
    // presença global. O cliente pede o histórico de um canal específico
    // mandando "join_channel" logo depois de abrir (e de novo toda vez
    // que troca de canal de texto na sidebar).

    ws.on("message", (raw) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (typeof data !== "object" || data === null) return;

      const type = (data as any).type;

      if (type === "join_channel") {
        handleJoinChannel(ws, data);
        return;
      }
      if (type === "send") {
        handleSend(data, username);
        return;
      }
      if (type === "edit") {
        handleEdit(data, username);
        return;
      }
      if (type === "delete") {
        handleDelete(data, username);
        return;
      }
      if (type === "react") {
        handleReact(data, username);
        return;
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      channelBySocket.delete(ws);

      const sockets = onlineByIdentity.get(username);
      sockets?.delete(ws);
      if (sockets && sockets.size === 0) {
        onlineByIdentity.delete(username);
      }
      broadcastPresence();
    });
  });
}

/** Troca qual canal de texto esse socket está "olhando" e manda o histórico dele de volta (só pra esse socket). */
function handleJoinChannel(ws: WebSocket, data: unknown) {
  const channelId = typeof (data as any).channelId === "string" ? (data as any).channelId : "";
  if (!channelId) return;

  const channel = channelExistsStmt.get(channelId) as unknown as { type: string } | undefined;
  if (!channel || channel.type !== "text") return; // canal não existe (ou é de voz, que não tem chat) — ignora

  channelBySocket.set(ws, channelId);
  ws.send(JSON.stringify({ type: "history", channelId, messages: getHistory(channelId) }));
}

function handleSend(data: unknown, username: string) {
  const channelId = typeof (data as any).channelId === "string" ? (data as any).channelId : "";
  const rawText = typeof (data as any).text === "string" ? (data as any).text : "";
  const text = rawText.trim().slice(0, MAX_TEXT_LENGTH);

  const rawAttachmentUrl = (data as any).attachmentUrl;
  const rawAttachmentType = (data as any).attachmentType;
  const hasAttachment =
    typeof rawAttachmentUrl === "string" &&
    rawAttachmentUrl.length > 0 &&
    ALLOWED_ATTACHMENT_TYPES.includes(rawAttachmentType) &&
    // Tudo que não é GIF (URL externa da Klipy) tem que apontar pra um
    // arquivo enviado aqui mesmo — impede mandar um link qualquer como "anexo".
    (rawAttachmentType === "gif" || rawAttachmentUrl.startsWith("/attachments/files/"));

  // Mensagem precisa ter CANAL válido e (TEXTO ou ANEXO) — as duas vazias
  // não é uma mensagem de verdade.
  if (!channelId || (!text && !hasAttachment)) return;
  const channel = channelExistsStmt.get(channelId) as unknown as { type: string } | undefined;
  if (!channel || channel.type !== "text") return;

  // Não valida se o ID respondido existe de verdade — é uma referência
  // "solta" de propósito. Se a mensagem original já tiver sido apagada
  // (ou estiver fora do histórico carregado), o cliente mostra um
  // aviso genérico em vez da citação (ver ChatPanel.tsx).
  const replyToId = typeof (data as any).replyToId === "string" ? (data as any).replyToId : null;

  const message: ChatMessage = {
    id: randomUUID(),
    channelId,
    username,
    text,
    timestamp: Date.now(),
    attachmentUrl: hasAttachment ? rawAttachmentUrl : null,
    attachmentType: hasAttachment ? (rawAttachmentType as AttachmentType) : null,
    attachmentName:
      hasAttachment && typeof (data as any).attachmentName === "string"
        ? (data as any).attachmentName.slice(0, 200)
        : null,
    editedAt: null,
    replyToId,
    reactions: [], // mensagem acabou de nascer, ninguém reagiu ainda
  };

  insertStmt.run(
    message.id,
    message.channelId,
    message.username,
    message.text,
    message.timestamp,
    message.attachmentUrl ?? null,
    message.attachmentType ?? null,
    message.attachmentName ?? null,
    message.replyToId ?? null
  );
  pruneStmt.run(channelId, channelId, HISTORY_CAP);
  pruneOrphanReactionsStmt.run();

  broadcastToChannel(channelId, JSON.stringify({ type: "message", message }));
}

/**
 * Só quem mandou a mensagem original pode editar. Mensagem só-anexo (sem
 * texto e sem editar pra ter texto) continua válida — o texto pode virar
 * vazio de novo se a pessoa apagar tudo no campo de edição, contanto que
 * ainda tenha um anexo.
 */
function handleEdit(data: unknown, username: string) {
  const id = typeof (data as any).id === "string" ? (data as any).id : "";
  const rawText = typeof (data as any).text === "string" ? (data as any).text : "";
  const text = rawText.trim().slice(0, MAX_TEXT_LENGTH);
  if (!id) return;

  const row = getByIdStmt.get(id) as unknown as MessageRow | undefined;
  if (!row || row.username !== username) return; // não existe ou não é dono — ignora silenciosamente
  if (!text && !row.attachment_url) return; // ficaria uma mensagem vazia de vez

  const editedAt = Date.now();
  updateTextStmt.run(text, editedAt, id);

  // Edição/remoção/reação são baixo volume e o cliente só aplica a
  // mudança se já tiver aquele ID carregado (ver ChatConnectionContext),
  // então não precisa filtrar por canal aqui — mandar pra todo mundo é
  // mais simples e inofensivo.
  broadcast(JSON.stringify({ type: "message_edited", id, text, editedAt }));
}

/** Só quem mandou a mensagem original pode apagar. */
function handleDelete(data: unknown, username: string) {
  const id = typeof (data as any).id === "string" ? (data as any).id : "";
  if (!id) return;

  const row = getByIdStmt.get(id) as unknown as MessageRow | undefined;
  if (!row || row.username !== username) return;

  deleteByIdStmt.run(id);
  deleteReactionsByMessageStmt.run(id);

  broadcast(JSON.stringify({ type: "message_deleted", id }));
}

/**
 * Reagir é um toggle: qualquer pessoa (não só o dono da mensagem) pode
 * reagir, e clicar de nome no mesmo emoji que já reagiu remove a reação —
 * não existe um "unreact" separado no protocolo, é o mesmo tipo "react"
 * pros dois casos, decidido aqui pelo que já existe no banco.
 */
function handleReact(data: unknown, username: string) {
  const messageId = typeof (data as any).messageId === "string" ? (data as any).messageId : "";
  const emoji = typeof (data as any).emoji === "string" ? (data as any).emoji.trim() : "";
  if (!messageId || !emoji || emoji.length > MAX_REACTION_LENGTH) return;

  const message = getByIdStmt.get(messageId) as unknown as MessageRow | undefined;
  if (!message) return; // mensagem não existe (ou já foi apagada nesse meio tempo) — ignora

  const alreadyReacted = reactionExistsStmt.get(messageId, username, emoji);
  if (alreadyReacted) {
    removeReactionStmt.run(messageId, username, emoji);
  } else {
    addReactionStmt.run(messageId, username, emoji, Date.now());
  }

  const rows = reactionsForMessageStmt.all(messageId) as unknown as { emoji: string; username: string }[];
  const reactions = groupReactionRows(rows);
  broadcast(JSON.stringify({ type: "message_reactions", messageId, reactions }));
}
