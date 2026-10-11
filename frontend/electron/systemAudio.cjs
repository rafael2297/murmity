// Captura do áudio do PC SEM o áudio do próprio Murmity — o mesmo jeito que
// clientes de Discord usam: a API de "process loopback" do Windows pede o
// áudio de tudo MENOS da árvore de processos que indicamos (aqui, o processo
// principal do Electron, que inclui janela, GPU e serviço de áudio).
//
// O trabalho pesado é de um módulo nativo (wasapi-loopback, instalado por
// scripts/setup-native-audio.cjs). Este arquivo só carrega o módulo, junta os
// pedaços de áudio (10 ms cada) em lotes e entrega pro React.
//
// Formato assumido dos pedaços: float32, estéreo intercalado (L R L R...), 48 kHz.
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const ADDON_RELATIVE_PATH = path.join(
  "node_modules",
  "wasapi-loopback",
  "prebuilds",
  "windows-x86_64",
  "wasapi-loopback-win32-x64.node"
);

// ~40 ms de áudio por mensagem: bem menos mensagens que 1 por pedaço, e a
// latência extra continua imperceptível.
const BATCH_BYTES = 48000 * 2 * 4 * 0.04;

let addon = null;
let loadFailed = false;
let running = false;
let pending = [];
let pendingBytes = 0;
let sendBatch = null;

function candidatePaths() {
  const paths = [];
  // Instalado: o electron-builder deixa o .node fora do app.asar.
  if (app.isPackaged) {
    paths.push(path.join(process.resourcesPath, "app.asar.unpacked", ADDON_RELATIVE_PATH));
  }
  // Desenvolvimento (e plano B dentro do asar).
  paths.push(path.join(__dirname, "..", ADDON_RELATIVE_PATH));
  return paths;
}

function loadAddon() {
  if (addon || loadFailed) return addon;
  if (process.platform !== "win32") {
    loadFailed = true;
    return null;
  }
  for (const candidate of candidatePaths()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const loaded = require(candidate);
      if (typeof loaded.start === "function" && typeof loaded.stop === "function") {
        addon = loaded;
        return addon;
      }
    } catch (err) {
      console.error(`[Murmity] não consegui carregar o módulo de áudio (${candidate}):`, err);
    }
  }
  loadFailed = true;
  console.error("[Murmity] módulo de áudio do PC (wasapi-loopback) não encontrado — rode scripts/setup-native-audio.cjs");
  return null;
}

function toBuffer(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  return null;
}

function flush() {
  if (!sendBatch || pending.length === 0) return;
  const data = Buffer.concat(pending, pendingBytes);
  pending = [];
  pendingBytes = 0;
  sendBatch(data);
}

function onChunk(raw) {
  const chunk = toBuffer(raw);
  // Estéreo float32 = 8 bytes por quadro; ignora qualquer coisa fora disso.
  if (!running || !chunk || chunk.length === 0 || chunk.length % 8 !== 0) return;
  pending.push(chunk);
  pendingBytes += chunk.length;
  if (pendingBytes >= BATCH_BYTES) flush();
}

/** Começa a capturar. `send(buffer)` recebe os lotes de áudio. Devolve true se começou. */
function start(send) {
  if (running) return true;
  const mod = loadAddon();
  if (!mod) return false;
  sendBatch = send;
  pending = [];
  pendingBytes = 0;
  running = true; // antes do start: os primeiros pedaços podem chegar na hora
  let ok = false;
  try {
    ok = Boolean(mod.start(process.pid, onChunk));
  } catch (err) {
    console.error("[Murmity] falha ao iniciar a captura de áudio do PC:", err);
  }
  if (!ok) {
    running = false;
    sendBatch = null;
  }
  return ok;
}

function stop() {
  if (!running) return;
  running = false;
  try {
    if (addon) addon.stop();
  } catch (err) {
    console.error("[Murmity] falha ao parar a captura de áudio do PC:", err);
  }
  pending = [];
  pendingBytes = 0;
  sendBatch = null;
}

module.exports = { start, stop };
