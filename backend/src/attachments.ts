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

// Sem limite de tamanho: o upload é gravado no disco AOS POUCOS (streaming),
// então um arquivo de vários GB não passa pela memória. O único limite real é
// o espaço livre em disco de quem hospeda.

// Sobras de uploads que foram interrompidos (app fechado no meio): apaga.
for (const leftover of fs.readdirSync(ATTACHMENTS_DIR)) {
  if (leftover.endsWith(".part")) fs.rmSync(path.join(ATTACHMENTS_DIR, leftover), { force: true });
}

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
      // ?name=... traz o nome original do arquivo pro download sair com ele.
      const name = typeof req.query.name === "string" && req.query.name ? req.query.name : path.basename(req.path);
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
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
router.post("/", requireAuth, (req: AuthedRequest, res) => {
  const kind = req.query.kind as Kind;
  if (!ALLOWED_KINDS.includes(kind)) {
    res.status(400).json({ error: "kind precisa ser 'image', 'audio', 'video' ou 'file'" });
    return;
  }

  const originalFilename = typeof req.query.filename === "string" ? req.query.filename : "";
  const filename = `${randomUUID()}${sanitizeExtension(originalFilename)}`;
  const finalPath = path.join(ATTACHMENTS_DIR, filename);
  const tempPath = `${finalPath}.part`; // só vira o nome final quando chega inteiro

  const out = fs.createWriteStream(tempPath);
  let bytes = 0;
  let finished = false;

  const discard = () => fs.rm(tempPath, { force: true }, () => {});
  const fail = (status: number, message: string) => {
    if (finished) return;
    finished = true;
    out.destroy();
    discard();
    if (!res.headersSent) res.status(status).json({ error: message });
  };

  req.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
  });
  // Conexão caiu no meio do envio: não deixa arquivo pela metade no disco.
  const abandon = () => {
    if (finished) return;
    finished = true;
    out.destroy();
    discard();
  };
  req.on("aborted", abandon);
  req.on("close", () => {
    if (!req.complete) abandon();
  });
  req.on("error", () => fail(500, "O envio do arquivo foi interrompido"));
  out.on("error", (err: NodeJS.ErrnoException) => {
    fail(500, err.code === "ENOSPC" ? "Sem espaço em disco no servidor" : "Não consegui salvar o arquivo");
  });
  out.on("finish", () => {
    if (finished) return;
    if (bytes === 0) {
      fail(400, "Arquivo vazio ou ausente");
      return;
    }
    fs.rename(tempPath, finalPath, (err) => {
      if (err) {
        fail(500, "Não consegui salvar o arquivo");
        return;
      }
      finished = true;
      res.status(201).json({
        url: `/attachments/files/${filename}`,
        type: kind,
        name: originalFilename || filename,
      });
    });
  });

  req.pipe(out);
});

export default router;
