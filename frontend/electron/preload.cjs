const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  listNetworkInterfaces: () => ipcRenderer.invoke("list-network-interfaces"),
  startBackend: (env) => ipcRenderer.invoke("start-backend", env),
  stopBackend: () => ipcRenderer.invoke("stop-backend"),
  startLiveKit: (nodeIp) => ipcRenderer.invoke("start-livekit", nodeIp),
  stopLiveKit: () => ipcRenderer.invoke("stop-livekit"),
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),
  setScreenShareSource: (id) => ipcRenderer.invoke("set-screen-share-source", id),
  focusWindow: () => ipcRenderer.invoke("focus-window"),
  onHostLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on("host-log", listener);
    // devolve uma função pra remover o listener depois, evitando duplicar
    // se o componente re-registrar em outra tentativa de hospedar.
    return () => ipcRenderer.removeListener("host-log", listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onRequestCloseChoice: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("request-close-choice", listener);
    return () => ipcRenderer.removeListener("request-close-choice", listener);
  },
  respondCloseChoice: (choice) => ipcRenderer.send("close-choice-response", choice),
  // Atalho global de alternar mudo (ver PROJECT_CONTEXT.md — só alterna,
  // não segura, porque o globalShortcut do Electron não tem evento de
  // soltura). Passar null/undefined só desregistra, sem registrar nada.
  registerMuteShortcut: (accelerator) => ipcRenderer.invoke("register-mute-shortcut", accelerator),
  onGlobalMuteToggle: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("global-mute-toggle", listener);
    return () => ipcRenderer.removeListener("global-mute-toggle", listener);
  },
});
