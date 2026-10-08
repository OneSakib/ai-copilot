const {
  app, BrowserWindow, globalShortcut, screen, session, desktopCapturer,
  systemPreferences, ipcMain, safeStorage, Tray, Menu, nativeImage, shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
const DEV_ONBOARD = isDev && !process.env.COPILOT_ONBOARD; // dev skips setup screens
const BACKEND_PORT = isDev ? 8000 : 18765;
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const ICON = path.join(app.getAppPath(), "build", "icon.png");

let win, tray, backend, backendReady;
let clickThrough = false;
let shield = true;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => win && win.showInactive());

/* ---------------- settings (API keys encrypted with the OS keychain) ---------------- */
const loadSettings = () => {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { return {}; }
};
const saveSettings = (s) => {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s));
};
const enc = (v) =>
  safeStorage.isEncryptionAvailable()
    ? { e: safeStorage.encryptString(v).toString("base64") }
    : { p: v };
const dec = (o) => (!o ? "" : o.e ? safeStorage.decryptString(Buffer.from(o.e, "base64")) : o.p || "");

/* ---------------- Python backend (bundled exe) ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stopBackend() {
  if (!backend) return;
  const p = backend;
  backend = null;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true });
    } else p.kill();
  } catch {}
}

function waitForBackend(tries) {
  return new Promise((resolve) => {
    let n = 0;
    const probe = () => {
      const req = http.get(`http://127.0.0.1:${BACKEND_PORT}/health`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => (++n >= tries ? resolve(false) : setTimeout(probe, 500)));
    };
    probe();
  });
}

async function startBackend() {
  stopBackend();
  if (isDev) return waitForBackend(4); // in dev you run uvicorn yourself on :8000
  await sleep(500);
  const s = loadSettings();
  const exe = path.join(process.resourcesPath, "backend", process.platform === "win32" ? "copilot-backend.exe" : "copilot-backend");
  backend = spawn(exe, [], {
    windowsHide: true,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: dec(s.anthropic),
      DEEPGRAM_API_KEY: dec(s.deepgram),
      COPILOT_PORT: String(BACKEND_PORT),
      COPILOT_DATA_DIR: app.getPath("userData"),
    },
  });
  backend.on("error", (e) => console.error("backend failed to start:", e));
  return waitForBackend(120);
}

/* ---------------- static UI server (packaged build) ---------------- */
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".txt": "text/plain", ".map": "application/json",
};

function serveStatic(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(dir, p);
      if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv.address().port));
  });
}

/* ---------------- IPC ---------------- */
async function getConfig() {
  await backendReady;
  const s = loadSettings();
  return {
    wsUrl: `ws://127.0.0.1:${BACKEND_PORT}/ws`,
    httpUrl: `http://127.0.0.1:${BACKEND_PORT}`,
    platform: process.platform,
    hasKeys: DEV_ONBOARD || !!(dec(s.anthropic) && dec(s.deepgram)),
    accepted: DEV_ONBOARD || !!s.accepted,
    shortcuts: shortcutState.list,
    shortcutFailures: shortcutState.failed,
  };
}

ipcMain.handle("config", getConfig);

ipcMain.handle("save-keys", async (_e, keys) => {
  const s = loadSettings();
  s.anthropic = enc(String(keys.anthropic || ""));
  s.deepgram = enc(String(keys.deepgram || ""));
  saveSettings(s);
  backendReady = startBackend(); // restart with the new keys
  return getConfig();
});

ipcMain.handle("accept-terms", async () => {
  const s = loadSettings();
  s.accepted = true;
  saveSettings(s);
  return getConfig();
});

// A shortcut/IPC call is not a "user gesture", but getDisplayMedia needs one,
// so we run the start inside the page with userGesture = true.
ipcMain.handle("auto-start", () => run("window.__copilot && window.__copilot.start()"));
ipcMain.on("quit", () => app.quit());

// Silent screenshot: grabs a frame straight from the OS. No shutter sound, no flash,
// no window is hidden or moved, and nothing is saved to disk.
async function captureScreen() {
  const b = win.getBounds();
  const d = screen.getDisplayNearestPoint({ x: b.x + 10, y: b.y + 10 });
  const scale = d.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: Math.round(d.size.width * scale), height: Math.round(d.size.height * scale) },
  });
  const idx = screen.getAllDisplays().findIndex((x) => x.id === d.id);
  const src = sources.find((s) => s.display_id === String(d.id)) || sources[idx] || sources[0];
  if (!src) throw new Error("No screen found to capture.");
  let img = src.thumbnail;
  if (img.getSize().width > 1568) img = img.resize({ width: 1568, quality: "best" });
  return img.toJPEG(85).toString("base64");
}
ipcMain.handle("capture-screen", () => captureScreen());

function run(code) {
  return win ? win.webContents.executeJavaScript(code, true).catch(() => {}) : Promise.resolve();
}

/* ---------------- window ---------------- */
async function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 460;
  const height = 640;

  win = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 48,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: ICON,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(shield);
  win.once("ready-to-show", () => win.showInactive());

  const url = isDev
    ? process.env.COPILOT_URL || "http://localhost:3000"
    : `http://127.0.0.1:${await serveStatic(path.join(app.getAppPath(), "out"))}`;
  win.loadURL(url);
}

function nudge(dx, dy) {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
}

// Ctrl+Alt+<key> avoids the common clashes of Ctrl+Shift+<key> (browser, VS Code, IME
// switchers, text selection) because those shortcuts are grabbed system-wide.
const DEFAULT_KEYS = {
  toggleWindow: "CommandOrControl+Alt+H",
  ask: "CommandOrControl+Alt+A",
  screenshot: "CommandOrControl+Alt+S",
  toggleListening: "CommandOrControl+Alt+L",
  clickThrough: "CommandOrControl+Alt+M",
  shield: "CommandOrControl+Alt+P",
  moveLeft: "CommandOrControl+Alt+Shift+Left",
  moveRight: "CommandOrControl+Alt+Shift+Right",
  moveUp: "CommandOrControl+Alt+Shift+Up",
  moveDown: "CommandOrControl+Alt+Shift+Down",
};
const LABELS = {
  toggleWindow: "show/hide",
  ask: "suggest reply",
  screenshot: "screenshot",
  toggleListening: "start/stop",
  clickThrough: "click-through",
  shield: "capture shield",
  moveLeft: "move",
};
const fmtKey = (a) =>
  a
    .replace("CommandOrControl", process.platform === "darwin" ? "Cmd" : "Ctrl")
    .replace("Alt", process.platform === "darwin" ? "Option" : "Alt");

let shortcutState = { list: [], failed: [] };

function registerShortcuts() {
  globalShortcut.unregisterAll();
  // Override any key in settings.json -> { "shortcuts": { "screenshot": "Ctrl+Alt+K" } }
  const keys = { ...DEFAULT_KEYS, ...(loadSettings().shortcuts || {}) };

  const actions = {
    toggleWindow: () => win && (win.isVisible() ? win.hide() : win.showInactive()),
    ask: () => run("window.__copilot && window.__copilot.ask()"),
    screenshot: () => run("window.__copilot && window.__copilot.screenshot()"),
    toggleListening: () => run("window.__copilot && window.__copilot.toggle()"),
    clickThrough: () => {
      if (!win) return;
      clickThrough = !clickThrough;
      win.setIgnoreMouseEvents(clickThrough, { forward: true });
      win.webContents.send("click-through", clickThrough);
    },
    shield: () => {
      if (!win) return;
      shield = !shield;
      win.setContentProtection(shield);
      win.webContents.send("protected", shield);
    },
    moveLeft: () => nudge(-40, 0),
    moveRight: () => nudge(40, 0),
    moveUp: () => nudge(0, -40),
    moveDown: () => nudge(0, 40),
  };

  shortcutState = { list: [], failed: [] };
  for (const [name, fn] of Object.entries(actions)) {
    const accel = keys[name];
    let ok = false;
    try {
      ok = globalShortcut.register(accel, fn);
    } catch (e) {
      console.error(`Invalid shortcut for ${name}: ${accel}`, e.message);
    }
    if (!ok) {
      console.error(`Shortcut not registered (in use by another app?): ${accel}`);
      shortcutState.failed.push(fmtKey(accel));
    }
    if (LABELS[name]) {
      const label = fmtKey(accel).replace(/\+Left$/, "+arrows");
      shortcutState.list.push({ label: LABELS[name], keys: label, ok });
    }
  }
}

function createTray() {
  // The overlay has no taskbar button, so the tray icon is how you quit.
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip("AI Copilot");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show / hide", click: () => (win.isVisible() ? win.hide() : win.showInactive()) },
      { label: "Start / stop listening", click: () => run("window.__copilot && window.__copilot.toggle()") },
      { label: "Open settings folder", click: () => shell.openPath(app.getPath("userData")) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ])
  );
  tray.on("click", () => (win.isVisible() ? win.hide() : win.showInactive()));
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock.hide();
    await systemPreferences.askForMediaAccess("microphone");
  }

  // Lets getDisplayMedia({audio:true}) return system audio (WASAPI loopback on
  // Windows, ScreenCaptureKit on macOS 13+) with no picker.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, callback) => {
      desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        callback({ video: sources[0], audio: "loopback" });
      });
    },
    { useSystemPicker: false }
  );
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(["media", "display-capture"].includes(permission))
  );

  registerShortcuts();
  backendReady = startBackend();
  await createWindow();
  createTray();
});

app.on("before-quit", stopBackend);
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
