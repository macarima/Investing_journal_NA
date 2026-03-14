const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const Store = require("electron-store");

const store = new Store({
  name: "investing-portfolio-data",
  defaults: {},
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "Investing Portfolio Manager",
    backgroundColor: "#0f1729",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the built renderer
  const indexPath = path.join(__dirname, "..", "dist", "index.html");
  mainWindow.loadFile(indexPath);

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── IPC: Storage ───
ipcMain.handle("store:get", (_event, key) => {
  try {
    const value = store.get(key);
    if (value !== undefined) return { key, value };
    return null;
  } catch {
    return null;
  }
});

ipcMain.handle("store:set", (_event, key, value) => {
  try {
    store.set(key, value);
    return { key, value };
  } catch {
    return null;
  }
});

ipcMain.handle("store:delete", (_event, key) => {
  try {
    store.delete(key);
    return { key, deleted: true };
  } catch {
    return null;
  }
});

ipcMain.handle("store:list", (_event, prefix) => {
  try {
    const all = store.store;
    let keys = Object.keys(all);
    if (prefix) keys = keys.filter((k) => k.startsWith(prefix));
    return { keys };
  } catch {
    return null;
  }
});

// ─── App lifecycle ───
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
