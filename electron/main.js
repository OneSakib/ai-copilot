const { app, BrowserWindow, globalShortcut, screen, session, desktopCapturer, systemPreferences } = require("electron");
const path = require("path");

const URL = process.env.COPILOT_URL || "http://localhost:3000";
let win;
let clickThrough = false;
let protectedWindow = true;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 460;
  const height = 640;

  win = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 48,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    type: process.platform === "darwin" ? "panel" : undefined, // doesn't steal focus from other apps
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep audio flowing when the window isn't focused
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(protectedWindow);
  win.loadURL(URL);
}

function nudge(dx, dy) {
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
}

function registerShortcuts() {
  const reg = (accel, fn) => globalShortcut.register(accel, fn);

  reg("CommandOrControl+Shift+Space", () =>
    win.isVisible() ? win.hide() : win.showInactive()
  );
  reg("CommandOrControl+Shift+Return", () => win.webContents.send("ask"));
  reg("CommandOrControl+Shift+L", () => win.webContents.send("toggle-listening"));
  reg("CommandOrControl+Shift+M", () => {
    clickThrough = !clickThrough;
    win.setIgnoreMouseEvents(clickThrough, { forward: true });
    win.webContents.send("click-through", clickThrough);
  });
  reg("CommandOrControl+Shift+P", () => {
    protectedWindow = !protectedWindow;
    win.setContentProtection(protectedWindow);
    win.webContents.send("protected", protectedWindow);
  });
  reg("CommandOrControl+Shift+Left", () => nudge(-40, 0));
  reg("CommandOrControl+Shift+Right", () => nudge(40, 0));
  reg("CommandOrControl+Shift+Up", () => nudge(0, -40));
  reg("CommandOrControl+Shift+Down", () => nudge(0, 40));
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock.hide(); // no Dock icon
    await systemPreferences.askForMediaAccess("microphone");
  }

  // Lets the renderer call getDisplayMedia({audio:true}) and receive system audio
  // (macOS 13+ via ScreenCaptureKit loopback) without a picker or BlackHole.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        callback({ video: sources[0], audio: "loopback" });
      });
    },
    { useSystemPicker: false }
  );

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(["media", "display-capture"].includes(permission))
  );

  createWindow();
  registerShortcuts();
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
