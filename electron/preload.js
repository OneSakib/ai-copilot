const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (cb) => {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("copilot", {
  onAsk: on("ask"),
  onToggleListening: on("toggle-listening"),
  onClickThrough: on("click-through"),
  onProtected: on("protected"),
});
