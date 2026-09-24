import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { getDataDir } from "./paths";

// node:sqlite é embutido no próprio Node.js (>=22.5) — sem módulo nativo
// externo pra compilar. Isso é essencial pra poder empacotar o backend num
// executável único (SEA) sem depender de toolchain de compilação (o
// better-sqlite3 antigo exigia python3/make/g++ e não empacota bem num
// único .exe). "Experimental" no Node só emite um aviso no console, não
// impede o uso.
//
// DB_PATH configurável (usado no Docker, ver docker-compose.yml). Fora do
// Docker/exe empacotado, fica na pasta de dados persistente do usuário
// (ver paths.ts) — NÃO do lado do .exe, pra sobreviver a atualizações.
const DB_PATH = process.env.DB_PATH || path.join(getDataDir(), "chat.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
`);

// Migração leve: adiciona as colunas de anexo (imagem/áudio/gif) em bancos
// já existentes, criados antes dessa feature. SQLite não tem "ADD COLUMN
// IF NOT EXISTS" — tenta adicionar e ignora o erro se a coluna já existir
// (banco criado numa versão mais nova, já com elas desde o início).
for (const columnDef of [
  "attachment_url TEXT",
  "attachment_type TEXT",
  "attachment_name TEXT",
  "edited_at INTEGER",
  "reply_to_id TEXT",
]) {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN ${columnDef}`);
  } catch {
    // já existe, segue o jogo
  }
}

// Soundboard: cada som é um arquivo em backend/data/sounds/ + esta linha
// com os metadados. Sem limite de quantidade nem de duração — só um teto
// de tamanho de arquivo por segurança (ver MAX_SOUND_BYTES em sounds.ts).
db.exec(`
  CREATE TABLE IF NOT EXISTS sounds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    added_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// Emojis personalizados: cada um é uma imagem em backend/data/emojis/ +
// esta linha. "code" é o atalho digitado no chat (ex: :buzina:) e
// precisa ser único. Sem limite de quantidade — só um teto de tamanho de
// arquivo por segurança (ver MAX_EMOJI_BYTES em emojis.ts).
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_emojis (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    added_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// Canais (texto e voz). "position" é a ordem de exibição dentro do
// próprio tipo (dois canais de texto podem ter position 0 e 1, e um canal
// de voz também pode ter position 0 — a ordenação sempre agrupa por tipo
// primeiro, ver channels.ts). IDs de canal de voz são usados DIRETO como
// nome de sala no LiveKit (ver rooms.ts, que já era genérico por
// roomName — não precisou mudar nada lá).
db.exec(`
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// IDs fixos (não randomUUID) só pros dois canais padrão criados na
// primeira vez que o servidor sobe — assim dá pra migrar as mensagens
// antigas (de antes de canais existirem) pra um ID conhecido, sem
// precisar guardar esse ID em outro lugar.
export const DEFAULT_TEXT_CHANNEL_ID = "default-text-geral";
export const DEFAULT_VOICE_CHANNEL_ID = "default-voice-geral";

const channelCount = db.prepare("SELECT COUNT(*) as count FROM channels").get() as { count: number };
if (channelCount.count === 0) {
  const now = Date.now();
  const insertChannel = db.prepare(
    "INSERT INTO channels (id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  insertChannel.run(DEFAULT_TEXT_CHANNEL_ID, "geral", "text", 0, now);
  insertChannel.run(DEFAULT_VOICE_CHANNEL_ID, "geral", "voice", 0, now);
}

// Migração: toda mensagem enviada antes de canais existirem (channel_id
// NULL) passa a pertencer ao canal de texto padrão acima — sem isso, o
// histórico de conversa de todo mundo sumiria da hora pra noite.
try {
  db.exec("ALTER TABLE messages ADD COLUMN channel_id TEXT");
} catch {
  // já existe, segue o jogo
}
db.exec(`UPDATE messages SET channel_id = '${DEFAULT_TEXT_CHANNEL_ID}' WHERE channel_id IS NULL`);

// Reações em mensagem: uma linha por (mensagem, pessoa, emoji) — repetir a
// mesma combinação não é possível (PRIMARY KEY), é isso que faz o toggle
// funcionar (clicar de novo no mesmo emoji remove a reação). "emoji" guarda
// o unicode direto (emoji nativo) ou ":codigo:" (emoji personalizado) —
// mesmo formato usado no texto da mensagem, pra reaproveitar o mesmo
// código de renderização (ver emojiText.tsx). Sem FK/CASCADE (node:sqlite
// não faz por padrão) — a limpeza de reação órfã é manual em chat.ts,
// junto com apagar mensagem e com a poda do histórico.
db.exec(`
  CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT NOT NULL,
    username TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, username, emoji)
  );
`);
