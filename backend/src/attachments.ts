import { Router } from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import express from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { getDataDir } from "./paths";
import { requireAuth, AuthedRequest } from "./middleware";

const router = Router();

// Anexos de mensagem (imagem/áudio/vídeo/qualquer arquivo) ficam em <pasta de dados>/attachments/
// — diferente de sons/emojis, não têm um catálogo reutilizável próprio no
// banco: são um anexo de UMA mensagem específica, e a própria linha da
// mensagem (tabela messages) guarda a URL. Ver paths.ts pra pasta base.
export const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || path.join(getDataDir(), "attachments");
fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

// Guarda-corpo técnico (não é limite de feature): evita anexo gigante
// travando o backend ou lotando o disco.
const MAX_ATTACHMENT_MB = 50;
const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;

// "image"/"audio"/"video" aparecem direto no chat; "file" é qualquer outra
// coisa (pdf, zip, docx...) e vira um cartão de download.
const ALLOWED_KINDS = ["image", "audio", "video", "file"] as const;
type Kind = (typeof ALLOWED_KINDS)[number];

function sanitizeExtension(originalFilename: string): string {
  const ext = path.extname(originalFilename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext && ext.length <= 8 ? ext : "";
}

// Só estas extensões podem ser ABERTAS direto no navegador (<img>, <audio>,
// <video>). Qualquer outra (.html, .svg, .js, .exe, .pdf...) é entregue com
// "Content-Disposition: attachment", ou seja, só baixa — um .html enviado
// por alguém nunca roda dentro do servidor.
const INLINE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp",
  ".mp3", ".wav", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".flac",
  ".mp4", ".webm", ".ogv",
]);

/** Serve /attachments/files/* com as travas de segurança acima. */
export const attachmentsStatic: RequestHandler[] = [
  (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!INLINE_EXTENSIONS.has(path.extname(req.path).toLowerCase())) {
      res.setHeader("Content-Disposition", "attachment");
    }
    next();
  },
  express.static(ATTACHMENTS_DIR),
];

/**
 * POST /attachments?kind=image|audio&filename=...
 * Corpo: bytes crus do arquivo (Content-Type = tipo do arquivo). O
 * frontend faz esse upload primeiro e só manda a mensagem de chat de
 * verdade (via WebSocket) depois, com a URL que essa rota devolve.
 */
router.post(
  "/",
  requireAuth,
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  (req: AuthedRequest, res) => {
    const kind = req.query.kind as Kind;
    if (!ALLOWED_KINDS.includes(kind)) {
      res.status(400).json({ error: "kind precisa ser 'image', 'audio', 'video' ou 'file'" });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Arquivo vazio ou ausente" });
      return;
    }

    const originalFilename = typeof req.query.filename === "string" ? req.query.filename : "";
    const id = randomUUID();
    const ext = sanitizeExtension(originalFilename);
    const filename = `${id}${ext}`;

    fs.writeFileSync(path.join(ATTACHMENTS_DIR, filename), req.body);

    res.status(201).json({
      url: `/attachments/files/${filename}`,
      type: kind,
      name: originalFilename || filename,
    });
  }
);

// Arquivo maior que o limite: devolve uma mensagem clara em JSON (o padrão do
// Express seria uma página de erro, que o app não consegue mostrar).
router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err && err.type === "entity.too.large") {
    res.status(413).json({ error: `Arquivo grande demais (máximo ${MAX_ATTACHMENT_MB} MB)` });
    return;
  }
  next(err);
});

export default router;
