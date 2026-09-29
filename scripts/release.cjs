const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Uso:
//   node release.cjs          -> versão nova    (0.1.9 -> 0.2.0)
//   node release.cjs fix      -> versão de fix  (0.2.0 -> 0.2.1)
//   node release.cjs major    -> versão maior   (0.2.1 -> 1.0.0)
const tipo = (process.argv[2] || "minor").toLowerCase();
const tiposValidos = ["minor", "fix", "major"];

if (!tiposValidos.includes(tipo)) {
  console.error(`Tipo inválido: "${tipo}". Use: ${tiposValidos.join(", ")}.`);
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const frontend = path.join(root, "frontend");
const packageJsonPath = path.join(frontend, "package.json");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const [major, minor, patch] = packageJson.version.split(".").map(Number);

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

execFileSync("git", ["add", "frontend/package.json", "frontend/package-lock.json"], {
  cwd: root,
  stdio: "inherit"
});

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
