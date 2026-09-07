import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startCollectorServer } from "../collector/server.mjs";
import { startStaticServer } from "./staticServer.mjs";

const APP_ID = "com.zhangyukwiver.contentinsights";
const APP_NAME = "内容数据工作台";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(moduleDirectory, "..");

let mainWindow = null;
let desktopRuntime = null;
let shutdownStarted = false;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

function openExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") void shell.openExternal(url.toString());
  } catch {
    // Ignore malformed or unsupported external URLs.
  }
}

function createMainWindow(appUrl) {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    icon: path.join(projectDirectory, "build", "icon.png"),
    backgroundColor: "#F4F5F6",
    webPreferences: {
      preload: path.join(moduleDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(appUrl)) return;
    event.preventDefault();
    openExternalUrl(url);
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  void window.loadURL(appUrl);
  return window;
}

async function startDesktopRuntime() {
  const collector = await startCollectorServer({
    port: 0,
    dataDirectory: path.join(app.getPath("userData"), "collector"),
    signerDirectory: app.isPackaged ? path.join(process.resourcesPath, "direct-signer") : undefined,
  });
  try {
    const web = await startStaticServer({ rootDirectory: path.join(projectDirectory, "dist") });
    return { collector, web };
  } catch (error) {
    await collector.close();
    throw error;
  }
}

async function stopDesktopRuntime() {
  if (!desktopRuntime) return;
  const runtime = desktopRuntime;
  desktopRuntime = null;
  await Promise.allSettled([runtime.web.close(), runtime.collector.close()]);
}

async function launch() {
  // macOS needs an app menu for ⌘Q and ⌘C/⌘V in text fields; Windows keeps no menu bar.
  Menu.setApplicationMenu(process.platform === "darwin"
    ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }])
    : null);
  desktopRuntime = await startDesktopRuntime();
  ipcMain.handle("desktop:get-collector-config", () => ({
    baseUrl: desktopRuntime?.collector.baseUrl,
    pairingCode: desktopRuntime?.collector.getPairingCode(),
  }));
  mainWindow = createMainWindow(desktopRuntime.web.url);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(launch).catch((error) => {
    dialog.showErrorBox(APP_NAME, error instanceof Error ? error.message : "应用启动失败。");
    app.quit();
  });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (shutdownStarted || !desktopRuntime) return;
  event.preventDefault();
  shutdownStarted = true;
  void stopDesktopRuntime().finally(() => app.exit(0));
});
