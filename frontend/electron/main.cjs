const { app, BrowserWindow, ipcMain, session, desktopCapturer, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let tray = null;
let backendProcess = null;
let livekitProcess = null;
let pendingScreenShareSourceId = null;
// Fechar a janela (X) só esconde ela na bandeja — isQuitting é o que
// diferencia isso de um "Sair" de verdade (menu da bandeja). Sem essa
// flag, não teria como saber se o "close" veio de alguém clicando no X
// (deve só esconder) ou de alguém realmente saindo do app.
let isQuitting = false;

const isDev = !app.isPackaged;

// Em dev, os .exe ficam em frontend/resources/. Em produção (empacotado
// pelo electron-builder), ficam em process.resourcesPath (configurado via
// "extraResources" no package.json).
function getResourcePath(name) {
  const base = isDev ? path.join(__dirname, "..", "resources") : process.resourcesPath;
  return path.join(base, name);
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
    icon: path.join(__dirname, "..", "build-icons", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Clicar no X não fecha o app de verdade — só esconde a janela pra
  // bandeja (o app continua rodando, a call/conexão continua de pé).
  // "Sair" de verdade só acontece pelo menu da bandeja (ou pelo próprio
  // sistema encerrando o processo). Sem isso, fechar a janela sem querer
  // derrubava a call e, se estivesse hospedando, tirava todo mundo.
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
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
  const iconPath = path.join(__dirname, "..", "build-icons", "icon.png");
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip("Murmity");

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
  }));
});

ipcMain.handle("set-screen-share-source", (_event, sourceId) => {
  pendingScreenShareSourceId = sourceId;
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

// --- IPC: atualização (chamado pelo botão "Nova versão" no React) ---

ipcMain.handle("install-update", () => {
  // Fecha o app e instala a versão já baixada — o instalador NSIS reabre
  // o app sozinho no final.
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
      callback({ video: chosen, audio: "loopback" });
    });
  });

  // Checa atualização no GitHub Releases sozinho, ao abrir. Em vez de
  // usar checkForUpdatesAndNotify() (que mostra uma notificação nativa
  // do Windows), escutamos os eventos e mandamos pro React — assim o
  // aviso é um elemento dentro do próprio app (seta verde "Nova versão",
  // ver UpdateBanner.tsx), não uma notificação do sistema.
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
  stopAllSidecars();
});
