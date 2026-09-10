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
