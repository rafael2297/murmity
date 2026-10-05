const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Uso:
//   node release.cjs          -> versão nova    (1.10.0 -> 1.11.0)
//   node release.cjs fix      -> versão de fix  (1.10.0 -> 1.10.1)
//   node release.cjs major    -> versão maior   (1.10.1 -> 2.0.0)
//
// Se houver alterações não commitadas no projeto, o script PARA e lista elas
// (o instalador é gerado a partir do que está no GitHub, então alteração
// solta ficaria de fora da versão publicada). Para commitar tudo junto com
// a versão: adicione --tudo   (ex: npm run electron:fix -- --tudo)
const args = process.argv.slice(2);
const incluirTudo = args.includes("--tudo");
const tipo = (args.find((a) => !a.startsWith("--")) || "minor").toLowerCase();
const tiposValidos = ["minor", "fix", "major"];

if (!tiposValidos.includes(tipo)) {
  console.error(`Tipo inválido: "${tipo}". Use: ${tiposValidos.join(", ")}.`);
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const frontend = path.join(root, "frontend");

// Confere ANTES de mexer em qualquer arquivo: alterações soltas (fora o
// próprio package.json/package-lock.json, que o script já commita).
const alteracoesSoltas = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8"
})
  .split("\n")
  .map((linha) => linha.replace(/\r$/, ""))
  .filter(Boolean)
  .filter((linha) => !/frontend\/package(-lock)?\.json"?$/.test(linha));

if (alteracoesSoltas.length > 0 && !incluirTudo) {
  console.error("Existem alterações que NÃO estão commitadas e ficariam fora da versão publicada:\n");
  console.error(alteracoesSoltas.map((linha) => "  " + linha).join("\n"));
  console.error("\nNada foi alterado. Escolha um jeito:");
  console.error("  1) Incluir tudo junto com a versão:  npm run electron:fix -- --tudo");
  console.error('  2) Commitar você mesmo antes:        git add -A && git commit -m "sua mensagem"');
  process.exit(1);
}
const packageJsonPath = path.join(frontend, "package.json");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
let [major, minor, patch] = packageJson.version.split(".").map(Number);

// Migração única: o projeto usava 0.X.Y, onde "X.Y" era a versão visível (ex: 0.1.9 = "1.9").
// Passa a usar X.Y.0 (0.1.10 -> 1.10.0), assim o fix vira 1.10.1 e o deploy vira 1.11.0.
if (major === 0) {
  [major, minor, patch] = [minor, patch, 0];
}

let version;
if (tipo === "fix") {
  version = `${major}.${minor}.${patch + 1}`;
} else if (tipo === "major") {
  version = `${major + 1}.0.0`;
} else {
  version = `${major}.${minor + 1}.0`;
}

const mensagem = tipo === "fix" ? `fix: v${version}` : `release: v${version}`;

packageJson.version = version;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

const packageLockPath = path.join(frontend, "package-lock.json");
if (fs.existsSync(packageLockPath)) {
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
  packageLock.version = version;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = version;
  }
  fs.writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + "\n");
}

execFileSync(
  "git",
  incluirTudo ? ["add", "-A"] : ["add", "frontend/package.json", "frontend/package-lock.json"],
  {
    cwd: root,
    stdio: "inherit"
  }
);

execFileSync("git", ["commit", "-m", mensagem], {
  cwd: root,
  stdio: "inherit"
});

execFileSync("git", ["tag", `v${version}`], {
  cwd: root,
  stdio: "inherit"
});

execFileSync("git", ["push", "origin", "main"], {
  cwd: root,
  stdio: "inherit"
});

execFileSync("git", ["push", "origin", `v${version}`], {
  cwd: root,
  stdio: "inherit"
});

console.log(`${tipo === "fix" ? "Fix" : "Release"} v${version} enviada para o GitHub.`);
