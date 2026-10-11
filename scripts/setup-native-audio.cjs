// Instala o módulo nativo que captura o áudio do PC SEM o áudio do Murmity
// (wasapi-loopback — o mesmo tipo de solução usada por clientes de Discord).
//
// Uso (na raiz do projeto, uma vez):   node scripts/setup-native-audio.cjs
// Depois faça commit do package.json e do package-lock.json (o lock guarda a
// versão exata, que o GitHub Actions vai reinstalar).
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const frontend = path.resolve(__dirname, "..", "frontend");
const PACKAGE = "wasapi-loopback";
const REPO = "github:thomas-quant/wasapi-loopback";

console.log(`Instalando ${REPO} ...`);
execSync(`npm install --save-optional ${REPO}`, { cwd: frontend, stdio: "inherit" });

const packageDir = path.join(frontend, "node_modules", PACKAGE);
const addonPath = path.join(packageDir, "prebuilds", "windows-x86_64", "wasapi-loopback-win32-x64.node");
if (!fs.existsSync(addonPath)) {
  console.error(`\nNão achei o módulo em ${addonPath}.`);
  console.error("Me mande o conteúdo da pasta " + packageDir + " pra eu ajustar o caminho.");
  process.exit(1);
}

// O .node precisa ficar FORA do app.asar no instalador.
const packageJsonPath = path.join(frontend, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
packageJson.build = packageJson.build || {};
const unpack = new Set(packageJson.build.asarUnpack || []);
unpack.add(`node_modules/${PACKAGE}/**`);
packageJson.build.asarUnpack = [...unpack];
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

// Conferência: carrega o módulo e mostra o que foi instalado.
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(addonPath)).digest("hex");
let exportsOk = false;
try {
  const loaded = require(addonPath);
  exportsOk = typeof loaded.start === "function" && typeof loaded.stop === "function";
} catch (err) {
  console.error("Aviso: não consegui carregar o módulo no Node:", err.message);
}

let resolved = "(não encontrado no package-lock.json)";
try {
  const lock = JSON.parse(fs.readFileSync(path.join(frontend, "package-lock.json"), "utf8"));
  resolved = lock.packages?.[`node_modules/${PACKAGE}`]?.resolved ?? resolved;
} catch {
  // sem lock: segue
}

console.log("\n=== Pronto ===");
console.log("Versão instalada (commit):", resolved);
console.log("Arquivo nativo:", addonPath);
console.log("SHA-256:", sha256);
console.log("Exporta start/stop:", exportsOk ? "sim" : "NÃO (algo está errado)");
console.log("\nÉ código nativo de terceiros: confira o repositório antes de publicar.");
console.log("Depois: git add -A && git commit  (ou npm run electron:fix -- --tudo)");
