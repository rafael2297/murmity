const { app, BrowserWindow, ipcMain, session, desktopCapturer, Tray, Menu, nativeImage, globalShortcut } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let tray = null;
let backendProcess = null;
let livekitProcess = null;
let pendingScreenShareSourceId = null;
// Atalho global de alternar mudo (Ctrl+Shift+M por padrão, configurável
// nas Configurações → Atalhos). Só existe UM por vez — trocar de atalho
// significa desregistrar este antes de registrar o novo.
let registeredMuteAccelerator = null;
// Fechar a janela (X) só esconde ela na bandeja — isQuitting é o que
// diferencia isso de um "Sair" de verdade (menu da bandeja). Sem essa
// flag, não teria como saber se o "close" veio de alguém clicando no X
// (deve só esconder) ou de alguém realmente saindo do app.
let isQuitting = false;
// Evita empilhar vários pedidos se a pessoa clicar no X várias vezes
// seguidas enquanto o modal já está aberto no React esperando resposta.
let waitingForCloseChoice = false;

const isDev = !app.isPackaged;

// Em dev, os .exe ficam em frontend/resources/. Em produção (empacotado
// pelo electron-builder), ficam em process.resourcesPath (configurado via
// "extraResources" no package.json).
function getResourcePath(name) {
  const base = isDev ? path.join(__dirname, "..", "resources") : process.resourcesPath;
  return path.join(base, name);
}

// Ícones da bandeja/janela ficam DENTRO de electron/icons/ (e não em
// build-icons/) porque o electron-builder só empacota "dist/" e
// "electron/" — a pasta build-icons/ não existe no app instalado, e era
// por isso que o ícone da bandeja aparecia como um quadrado transparente.
// Lemos o arquivo com fs (que entende o app.asar) e criamos a imagem a
// partir do buffer, o que funciona igual em dev e empacotado.
function loadIcon(fileName) {
  try {
    const buffer = fs.readFileSync(path.join(__dirname, "icons", fileName));
    return nativeImage.createFromBuffer(buffer);
  } catch (err) {
    console.debug(`Não consegui carregar o ícone ${fileName}:`, err);
    return nativeImage.createEmpty();
  }
}

// Várias resoluções, pro Windows escolher a mais nítida conforme o zoom
// (escala) da tela: 100% usa 16px, 150% usa 24px, 200% usa 32px, etc.
function createTrayIcon() {
  const icon = nativeImage.createEmpty();
  const sizes = [
    { file: "tray-16.png", scaleFactor: 1 },
    { file: "tray-24.png", scaleFactor: 1.5 },
    { file: "tray-32.png", scaleFactor: 2 },
    { file: "tray-48.png", scaleFactor: 3 },
  ];
  for (const { file, scaleFactor } of sizes) {
    const image = loadIcon(file);
    if (image.isEmpty()) continue;
    icon.addRepresentation({ scaleFactor, buffer: image.toPNG() });
  }
  return icon;
}

function sendToRenderer(channel, payload) {
  // Bug corrigido: ao fechar o app enquanto backend/LiveKit ainda estão de
  // pé, eles mandam umas últimas linhas de stdout/stderr DEPOIS da janela
  // já ter sido destruída (window-all-closed roda antes dos processos
  // filhos morrerem de vez) — sem essa checagem, .webContents.send()
  // lançava "Object has been destroyed" e derrubava o processo principal
  // com um popup de erro, mesmo o app já tendo fechado direito por baixo.
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function sendLog(line) {
  sendToRenderer("host-log", String(line));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    title: "Murmity",
    icon: loadIcon("app-256.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Clicar no X pergunta o que fazer: minimizar pra bandeja (app continua
  // rodando, call/conexão seguem de pé) ou fechar de verdade. A pergunta em
  // si é um modal do próprio React (ver CloseConfirmModal.tsx) — não a
  // caixinha nativa do sistema, que destoa do resto do app — por isso só
  // avisamos o renderer aqui e esperamos a resposta vir pelo IPC abaixo.
  // "Sair" pelo menu da bandeja continua indo direto (isQuitting), sem
  // perguntar de novo.
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (waitingForCloseChoice) return;

    waitingForCloseChoice = true;
    sendToRenderer("request-close-choice", null);
  });

  // Se um arquivo for solto numa tela do app que não trata o "soltar", o
  // Chromium tentaria ABRIR o arquivo e trocaria a página do app por ele
  // (sumindo com a interface). Bloqueia qualquer navegação pra fora da
  // página atual — o chat trata o drop de arquivos por conta própria.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(`Murmity v${app.getVersion()}`);

  const contextMenu = Menu.buildFromTemplate([
    { label: "Abrir Murmity", click: showWindow },
    { type: "separator" },
    {
      label: "Sair",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  // Clique esquerdo abre direto (comportamento padrão do Windows pra
  // bandeja); clique direito mostra o menu com "Sair" — não associamos
  // o menu ao clique esquerdo de propósito, senão ele também abriria o
  // menu em vez de só restaurar a janela.
  tray.on("click", showWindow);
  tray.on("right-click", () => tray.popUpContextMenu(contextMenu));
}

function stopAllSidecars() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (livekitProcess) {
    livekitProcess.kill();
    livekitProcess = null;
  }
}

// Roda o taskkill do Windows e espera ele terminar (ignora erro: "processo
// não encontrado" também é um resultado ok pra gente).
function runTaskkill(args) {
  return new Promise((resolve) => {
    const child = spawn("taskkill", args, { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(resolve, 3000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.on("error", done);
    child.on("exit", done);
  });
}

// Versão de stopAllSidecars() que ESPERA os processos realmente morrerem.
// O kill() simples só pede pra encerrar e volta na hora — como o instalador
// da atualização abre logo em seguida, o murmity-backend.exe e o
// livekit-server.exe ainda podiam estar abertos e travar a troca dos
// arquivos (a atualização falhava e o app abria na versão antiga).
async function stopAllSidecarsAndWait() {
  const procs = [backendProcess, livekitProcess].filter(Boolean);
  backendProcess = null;
  livekitProcess = null;

  if (process.platform === "win32") {
    for (const proc of procs) {
      if (proc.pid) await runTaskkill(["/PID", String(proc.pid), "/T", "/F"]);
    }
    // Garantia extra: sobra de uma execução anterior (ex: app que fechou
    // de forma inesperada) também trava a instalação.
    await runTaskkill(["/IM", "murmity-backend.exe", "/T", "/F"]);
    await runTaskkill(["/IM", "livekit-server.exe", "/T", "/F"]);
  } else {
    procs.forEach((proc) => proc.kill());
  }

  // Dá um respiro pro Windows liberar os arquivos.
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function waitForHealth(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ainda subindo, tenta de novo
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Não respondeu em ${url} depois de ${timeoutMs / 1000}s.`);
}

// --- IPC: chamado pelo preload.cjs (window.electronAPI.*) ---

// --- IPC: seletor de tela/janela customizado ---

ipcMain.handle("get-desktop-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 300, height: 200 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnailDataURL: s.thumbnail.toDataURL(),
    // O id do Electron já vem prefixado por tipo ("screen:0:0" ou
    // "window:12345:0") — só separa isso num campo próprio, pra dar pra
    // agrupar em abas "Telas"/"Aplicativos" no seletor (ver
    // ScreenSharePicker.tsx), igual ao Discord.
    type: s.id.startsWith("screen:") ? "screen" : "window",
  }));
});

// Tirar o áudio do próprio Murmity da captura do sistema (pra ninguém se
// ouvir de volta na tela compartilhada) usa a "captura de áudio por
// processo" do Windows. Ela funciona no Windows 10 22H2 (build 19045) e no
// Windows 11 — mesmo critério usado por apps como o Vesktop, que testaram:
// no build 19041 essa captura falha. Em Windows mais antigo o React cai no
// plano B (mutar os outros localmente). Quem pede a exclusão é o React, com
// audio: { restrictOwnAudio: true } — o Electron 43.4+ traduz isso sozinho.
const MIN_WINDOWS_BUILD_OWN_AUDIO_EXCLUSION = 19045;

function windowsSupportsOwnAudioExclusion() {
  if (process.platform !== "win32") return false;
  const build = Number(os.release().split(".")[2]);
  return Number.isFinite(build) && build >= MIN_WINDOWS_BUILD_OWN_AUDIO_EXCLUSION;
}

ipcMain.handle("can-exclude-own-audio", () => windowsSupportsOwnAudioExclusion());

ipcMain.handle("set-screen-share-source", (_event, sourceId) => {
  pendingScreenShareSourceId = sourceId;
});

// --- IPC: atalho global de alternar mudo ---
//
// O globalShortcut do Electron só sabe avisar quando a tecla é APERTADA —
// não existe callback de soltura (ver docs oficiais). Por isso isso aqui
// é só um "alternar mudo" que funciona em qualquer lugar (até com um jogo
// em foco), não um "segure pra falar" de verdade — esse fica restrito a
// dentro do app (ver VoiceMicControl.tsx, que ouve keydown/keyup direto
// no navegador, funcionando só com a janela do Murmity em foco).
ipcMain.handle("register-mute-shortcut", (_event, accelerator) => {
  if (registeredMuteAccelerator) {
    globalShortcut.unregister(registeredMuteAccelerator);
    registeredMuteAccelerator = null;
  }
  if (!accelerator) return true; // só queria desregistrar mesmo

  const ok = globalShortcut.register(accelerator, () => {
    sendToRenderer("global-mute-toggle", null);
  });
  if (ok) registeredMuteAccelerator = accelerator;
  // false aqui quase sempre quer dizer que outro programa já pegou essa
  // combinação primeiro — o SO não deixa dois apps disputando o mesmo
  // atalho global.
  return ok;
});

ipcMain.handle("list-network-interfaces", () => {
  const nets = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        result.push({ name, address: addr.address });
      }
    }
  }
  return result;
});

// Mesma simplificação já documentada no host.ts do Tauri: sem .env do
// lado do sidecar, então passamos as variáveis explicitamente. Mesma
// chave fixa pra todo mundo que hospedar — ok pro estágio atual.
const DEFAULT_BACKEND_ENV = {
  PORT: "3000",
  JWT_SECRET: "murmity-chave-padrao-troque-se-for-expor-publicamente",
  LIVEKIT_API_KEY: "devkey",
  LIVEKIT_API_SECRET: "secret",
};

ipcMain.handle("start-backend", async (_event, envOverrides = {}) => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }

  const exeName = process.platform === "win32" ? "murmity-backend.exe" : "murmity-backend";
  const exePath = getResourcePath(exeName);

  backendProcess = spawn(exePath, [], {
    env: { ...process.env, ...DEFAULT_BACKEND_ENV, ...envOverrides },
  });
  backendProcess.stdout.on("data", (d) => sendLog(d));
  backendProcess.stderr.on("data", (d) => sendLog(d));
  backendProcess.on("error", (err) => sendLog(`Erro ao iniciar backend: ${err.message}`));

  await waitForHealth("http://localhost:3000/health");
  return { url: "http://localhost:3000" };
});

ipcMain.handle("stop-backend", () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});

ipcMain.handle("start-livekit", async (_event, nodeIp) => {
  if (livekitProcess) {
    livekitProcess.kill();
    livekitProcess = null;
  }

  const exeName = process.platform === "win32" ? "livekit-server.exe" : "livekit-server";
  const exePath = getResourcePath(exeName);

  livekitProcess = spawn(exePath, ["--dev", "--bind", "0.0.0.0", `--node-ip=${nodeIp}`]);
  livekitProcess.stdout.on("data", (d) => sendLog(d));
  livekitProcess.stderr.on("data", (d) => sendLog(d));
  livekitProcess.on("error", (err) => sendLog(`Erro ao iniciar LiveKit: ${err.message}`));

  await waitForHealth("http://localhost:7880");
});

ipcMain.handle("stop-livekit", () => {
  if (livekitProcess) {
    livekitProcess.kill();
    livekitProcess = null;
  }
});

ipcMain.handle("focus-window", () => {
  showWindow();
});

// Resposta do modal do React (ver CloseConfirmModal.tsx) ao pedido de
// "request-close-choice" acima.
ipcMain.on("close-choice-response", (_event, choice) => {
  waitingForCloseChoice = false;
  if (choice === "minimize") {
    mainWindow?.hide();
  } else if (choice === "quit") {
    isQuitting = true;
    app.quit();
  }
  // choice === "cancel" (ou qualquer outra coisa) — não faz nada, janela
  // continua aberta.
});

// --- IPC: atualização (chamado pelo botão "Nova versão" no React) ---

ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("install-update", async () => {
  // Fecha o app e instala a versão já baixada — o instalador NSIS reabre
  // o app sozinho no final.
  //
  // isQuitting = true ANTES de fechar: sem isso, o "close" da janela cai
  // no handler lá em cima e pergunta "minimizar ou fechar?" no meio da
  // atualização. Também paramos backend/LiveKit antes, senão os .exe
  // deles continuam abertos e o instalador reclama que o app está em uso.
  isQuitting = true;
  await stopAllSidecarsAndWait();
  autoUpdater.quitAndInstall();
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Diferente do Tauri (WebView2), o Chromium embutido no Electron não
  // sabe compartilhar tela sozinho — precisa registrar esse handler.
  // "useSystemPicker" (seletor nativo do Windows) não se mostrou confiável
  // na prática, então construímos nosso próprio seletor (ver
  // ScreenSharePicker.tsx no frontend + get-desktop-sources abaixo) — o
  // usuário escolhe lá, a gente guarda o ID escolhido, e usa ele aqui.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
      const chosen = sources.find((s) => s.id === pendingScreenShareSourceId) || sources[0];
      pendingScreenShareSourceId = null;
      // "loopback" pede o áudio do sistema (Windows) junto com o vídeo,
      // complementando o systemAudio:"include" pedido do lado do React.
      // Quando o React pede { restrictOwnAudio: true }, o Electron 43.4+
      // troca isso por "loopbackWithoutChrome": todo o áudio do PC, MENOS o
      // do próprio Murmity (vozes dos outros, soundboard etc.).
      callback({ video: chosen, audio: "loopback" });
    });
  });

  // Checa atualização no GitHub Releases sozinho, ao abrir. Em vez de
  // usar checkForUpdatesAndNotify() (que mostra uma notificação nativa
  // do Windows), escutamos os eventos e mandamos pro React — assim o
  // aviso é um elemento dentro do próprio app (seta verde "Nova versão",
  // ver UpdateBanner.tsx), não uma notificação do sistema.
  // Log do atualizador em arquivo (updater.log, dentro da pasta de dados do
  // app em %APPDATA%) — se uma atualização falhar de novo, dá pra ver o motivo.
  const updaterLogPath = path.join(app.getPath("userData"), "updater.log");
  const writeUpdaterLog = (level, message) => {
    try {
      const text =
        message instanceof Error
          ? message.stack || message.message
          : typeof message === "string"
            ? message
            : JSON.stringify(message);
      fs.appendFileSync(updaterLogPath, `[${new Date().toISOString()}] ${level} ${text}\n`);
    } catch {
      // log nunca pode derrubar o app
    }
  };
  autoUpdater.logger = {
    info: (message) => writeUpdaterLog("INFO", message),
    warn: (message) => writeUpdaterLog("WARN", message),
    error: (message) => writeUpdaterLog("ERROR", message),
    debug: (message) => writeUpdaterLog("DEBUG", message),
  };
  writeUpdaterLog("INFO", `Murmity v${app.getVersion()} iniciado — checando atualização`);

  autoUpdater.on("update-available", (info) => {
    sendLog(`Atualização disponível: v${info.version} — baixando em segundo plano...`);
    sendToRenderer("update-status", { status: "available", version: info.version });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendLog(`Atualização v${info.version} baixada — pronta pra instalar.`);
    sendToRenderer("update-status", { status: "downloaded", version: info.version });
  });

  autoUpdater.on("error", (err) => {
    console.debug("Erro checando/baixando atualização (normal em dev, sem release publicado ainda):", err);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.debug("Checagem de atualização falhou (normal em dev, sem release publicado ainda):", err);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopAllSidecars();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  // Qualquer saída de verdade (atualização, desligar o Windows, "Sair" da
  // bandeja) não deve cair no modal de "minimizar ou fechar".
  isQuitting = true;
  stopAllSidecars();
  // globalShortcut.register fica registrado no SO até alguém desregistrar
  // — sem isso, fechar o app deixaria o atalho "preso" (nenhum outro
  // programa conseguiria usar aquela combinação até reiniciar o PC).
  globalShortcut.unregisterAll();
});
