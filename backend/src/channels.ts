import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "./db";
import { requireAuth, AuthedRequest } from "./middleware";
import { broadcastChatEvent } from "./chat";

const router = Router();

const MAX_NAME_LENGTH = 60;
type ChannelType = "text" | "voice";
const ALLOWED_TYPES: ChannelType[] = ["text", "voice"];

interface ChannelRow {
  id: string;
  name: string;
  type: ChannelType;
  position: number;
  created_at: number;
}

const listStmt = db.prepare("SELECT * FROM channels ORDER BY type ASC, position ASC, created_at ASC");
const getStmt = db.prepare("SELECT * FROM channels WHERE id = ?");
const insertStmt = db.prepare(
  "INSERT INTO channels (id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?)"
);
const deleteStmt = db.prepare("DELETE FROM channels WHERE id = ?");
const maxPositionStmt = db.prepare("SELECT COALESCE(MAX(position), -1) as maxPos FROM channels WHERE type = ?");
const countByTypeStmt = db.prepare("SELECT COUNT(*) as count FROM channels WHERE type = ?");
// Cascata manual ao apagar canal de texto — sem isso, mensagem e reação
// de um canal apagado ficam pra sempre órfãs no banco (nunca mais
// alcançáveis pela UI, mas ocupando espaço à toa).
const deleteMessagesByChannelStmt = db.prepare("DELETE FROM messages WHERE channel_id = ?");
const deleteOrphanReactionsStmt = db.prepare("DELETE FROM reactions WHERE message_id NOT IN (SELECT id FROM messages)");

function toPublic(row: ChannelRow) {
  return { id: row.id, name: row.name, type: row.type, position: row.position, createdAt: row.created_at };
}

/**
 * Corta por CARACTERE (ponto de código Unicode), não por unidade UTF-16
 * crua — mesmo motivo/implementação do truncateByCharacter em sounds.ts
 * (nome de canal também pode ter emoji).
 */
function truncateByCharacter(text: string, maxLength: number): string {
  return Array.from(text).slice(0, maxLength).join("");
}

/** GET /channels — lista todos os canais (texto e voz), na ordem de exibição. */
router.get("/", requireAuth, (_req, res) => {
  const rows = listStmt.all() as unknown as ChannelRow[];
  res.json({ channels: rows.map(toPublic) });
});

/**
 * POST /channels  { name, type }
 * Qualquer pessoa autenticada pode criar canal — mesma simplificação sem
 * cargo/permissão que já existe no resto do app (ver rooms.ts): aceitável
 * pro tamanho do grupo (uso privado entre amigos).
 */
router.post("/", requireAuth, (req: AuthedRequest, res) => {
  const rawName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const name = truncateByCharacter(rawName, MAX_NAME_LENGTH);
  const type = req.body?.type;

  if (!name) {
    res.status(400).json({ error: "Nome do canal é obrigatório" });
    return;
  }
  if (!ALLOWED_TYPES.includes(type)) {
    res.status(400).json({ error: "Tipo de canal inválido" });
    return;
  }

  const maxPos = (maxPositionStmt.get(type) as { maxPos: number }).maxPos;
  const row: ChannelRow = {
    id: randomUUID(),
    name,
    type,
    position: maxPos + 1,
    created_at: Date.now(),
  };
  insertStmt.run(row.id, row.name, row.type, row.position, row.created_at);

  const channel = toPublic(row);
  // Todo mundo conectado (mesmo em outro canal) precisa saber que um canal
  // novo apareceu, pra atualizar a lista na sidebar em tempo real.
  broadcastChatEvent(JSON.stringify({ type: "channel_created", channel }));

  res.status(201).json({ channel });
});

/**
 * DELETE /channels/:id
 * Não deixa apagar o ÚLTIMO canal de um tipo — sem isso a pessoa ficaria
 * sem nenhum canal de texto (ou de voz) pra usar. Mensagens do canal de
 * texto são apagadas junto (cascata manual, ver comentário nos statements
 * acima); canal de voz não tem nada persistido além dele mesmo (a call em
 * si é efêmera, do lado do LiveKit).
 */
router.delete("/:id", requireAuth, (req, res) => {
  const row = getStmt.get(req.params.id) as unknown as ChannelRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Canal não encontrado" });
    return;
  }

  const remainingOfType = (countByTypeStmt.get(row.type) as { count: number }).count;
  if (remainingOfType <= 1) {
    res
      .status(400)
      .json({ error: `Precisa deixar pelo menos um canal de ${row.type === "text" ? "texto" : "voz"}` });
    return;
  }

  if (row.type === "text") {
    deleteMessagesByChannelStmt.run(row.id);
    deleteOrphanReactionsStmt.run();
  }
  deleteStmt.run(row.id);

  broadcastChatEvent(JSON.stringify({ type: "channel_deleted", id: row.id }));

  res.json({ ok: true });
});

export default router;
