import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import "dotenv/config";
import identifyRouter from "./identify";
import roomsRouter from "./rooms";
import channelsRouter from "./channels";
import soundsRouter, { SOUNDS_DIR } from "./sounds";
import emojisRouter, { EMOJIS_DIR } from "./emojis";
import attachmentsRouter, { ATTACHMENTS_DIR } from "./attachments";
import linkPreviewRouter from "./linkpreview";
import { setupChat } from "./chat";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", identifyRouter);
app.use("/rooms", roomsRouter);
app.use("/channels", channelsRouter);
// Arquivos de áudio do soundboard, imagens de emoji e anexos de chat
// (imagem/áudio), servidos como estáticos (o upload em si é tratado nos
// routers, com corpo bruto em vez de multipart). Busca de GIF não passa
// pelo nosso backend — é feita direto do frontend pra API da Klipy, ver
// GifPicker.tsx.
app.use("/sounds/files", express.static(SOUNDS_DIR));
app.use("/sounds", soundsRouter);
app.use("/emojis/files", express.static(EMOJIS_DIR));
app.use("/emojis", emojisRouter);
app.use("/attachments/files", express.static(ATTACHMENTS_DIR));
app.use("/attachments", attachmentsRouter);
app.use("/link-preview", linkPreviewRouter);

// WebSocket precisa de um servidor HTTP explícito (não dá pra usar
// app.listen direto quando também tem WS na mesma porta).
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/chat" });
setupChat(wss);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT} (HTTP + WebSocket /ws/chat)`);
});
