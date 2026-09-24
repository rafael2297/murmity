import { Router } from "express";
import express from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { db } from "./db";
import { getDataDir } from "./paths";
import { requireAuth, AuthedRequest } from "./middleware";
import { broadcastChatEvent } from "./chat";

const router = Router();

// Imagens ficam em <pasta de dados>/emojis/<id><extensão> — mesma base
// do banco SQLite e do soundboard (ver paths.ts), na pasta de dados do
// usuário, NÃO do lado do .exe, pra sobreviver a atualizações do app.
export const EMOJIS_DIR = process.env.EMOJIS_DIR || path.join(getDataDir(), "emojis");
fs.mkdirSync(EMOJIS_DIR, { recursive: true });

// Guarda-corpo técnico (não é um limite "estilo Discord" de propósito —
// é só que uma imagem de emoji gigante não faz sentido e sobrecarregaria
// o chat renderizando ela inline). Sem limite de QUANTIDADE de emojis.
const MAX_EMOJI_BYTES = 5 * 1024 * 1024; // 5 MB

// :codigo: usado no chat. Minúsculo, só letras/números/underscore, sem
// espaço — pra não ter ambiguidade na hora de reconhecer ":algo:" dentro
// do texto de uma mensagem.
const CODE_PATTERN = /^[a-z0-9_]{2,32}$/;

interface EmojiRow {
  id: string;
  code: string;
  filename: string;
  added_by: string;
  created_at: number;
}

const insertStmt = db.prepare(
  "INSERT INTO custom_emojis (id, code, filename, added_by, created_at) VALUES (?, ?, ?, ?, ?)"
);
const listStmt = db.prepare("SELECT * FROM custom_emojis ORDER BY created_at ASC");
const getStmt = db.prepare("SELECT * FROM custom_emojis WHERE id = ?");
const getByCodeStmt = db.prepare("SELECT * FROM custom_emojis WHERE code = ?");
const deleteStmt = db.prepare("DELETE FROM custom_emojis WHERE id = ?");

function toPublic(row: EmojiRow) {
  return {
    id: row.id,
    code: row.code,
    addedBy: row.added_by,
    createdAt: row.created_at,
    url: `/emojis/files/${row.filename}`,
  };
}

function sanitizeExtension(originalFilename: string): string {
  const ext = path.extname(originalFilename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext && ext.length <= 6 ? ext : "";
}

function normalizeCode(raw: string): string {
  // Aceita o usuário digitando com ou sem ":" (":buzina:" ou "buzina"),
  // com espaço em vez de underscore, maiúsculas etc, e normaliza tudo.
  return raw
    .trim()
    .toLowerCase()
    .replace(/^:+|:+$/g, "")
    .replace(/\s+/g, "_");
}

/** GET /emojis — lista todos os emojis personalizados disponíveis. */
router.get("/", requireAuth, (_req, res) => {
  const rows = listStmt.all() as unknown as EmojiRow[];
  res.json({ emojis: rows.map(toPublic) });
});

/**
 * POST /emojis?code=...&filename=...
 * Corpo: bytes crus da imagem (Content-Type = tipo do arquivo).
 * Sem limite de quantidade de emojis — só um teto de tamanho de arquivo
 * (MAX_EMOJI_BYTES) por segurança técnica.
 */
router.post(
  "/",
  requireAuth,
  express.raw({ type: () => true, limit: MAX_EMOJI_BYTES }),
  (req: AuthedRequest, res) => {
    const rawCode = typeof req.query.code === "string" ? req.query.code : "";
    const code = normalizeCode(rawCode);
    const originalFilename = typeof req.query.filename === "string" ? req.query.filename : "";

    if (!CODE_PATTERN.test(code)) {
      res.status(400).json({
        error: "Código inválido — use só letras minúsculas, números e underscore (2 a 32 caracteres)",
      });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Imagem vazia ou ausente" });
      return;
    }
    if (getByCodeStmt.get(code)) {
      res.status(409).json({ error: `Já existe um emoji com o código :${code}:` });
      return;
    }

    const id = randomUUID();
    const ext = sanitizeExtension(originalFilename);
    const filename = `${id}${ext}`;

    fs.writeFileSync(path.join(EMOJIS_DIR, filename), req.body);

    const row: EmojiRow = {
      id,
      code,
      filename,
      added_by: req.user!.username,
      created_at: Date.now(),
    };
    insertStmt.run(row.id, row.code, row.filename, row.added_by, row.created_at);

    const emoji = toPublic(row);
    // Todo mundo com o chat aberto precisa saber do emoji novo na hora —
    // sem isso, só aparece pra quem reabrir o app (ver ChatConnectionContext).
    broadcastChatEvent(JSON.stringify({ type: "emoji_created", emoji }));

    res.status(201).json({ emoji });
  }
);

/**
 * DELETE /emojis/:id — remove um emoji (arquivo + registro). Só quem
 * adicionou pode remover (mesma regra do soundboard).
 */
router.delete("/:id", requireAuth, (req: AuthedRequest, res) => {
  const row = getStmt.get(req.params.id) as unknown as EmojiRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Emoji não encontrado" });
    return;
  }
  if (row.added_by !== req.user!.username) {
    res.status(403).json({ error: "Só quem adicionou esse emoji pode removê-lo" });
    return;
  }

  deleteStmt.run(row.id);
  fs.rm(path.join(EMOJIS_DIR, row.filename), { force: true }, () => {});

  broadcastChatEvent(JSON.stringify({ type: "emoji_deleted", id: row.id }));

  res.json({ ok: true });
});

export default router;
