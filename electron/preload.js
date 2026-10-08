const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (cb) => {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("copilot", {
  getConfig: () => ipcRenderer.invoke("config"),
  saveKeys: (keys) => ipcRenderer.invoke("save-keys", keys),
  acceptTerms: () => ipcRenderer.invoke("accept-terms"),
  captureScreen: () => ipcRenderer.invoke("capture-screen"),
  autoStart: () => ipcRenderer.invoke("auto-start"),
  quit: () => ipcRenderer.send("quit"),
  onClickThrough: on("click-through"),
  onProtected: on("protected"),
});
