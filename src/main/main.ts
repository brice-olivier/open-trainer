import path from 'path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import TrainerController, {
  ConnectOptions,
  StartSessionOptions,
  TelemetryPayload,
  StatusPayload,
} from './trainerController';

let mainWindow: BrowserWindow | null = null;
const controller = new TrainerController();

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'ERG Trainer POC',
  });

  controller.on('telemetry', (payload: TelemetryPayload) => {
    mainWindow?.webContents.send('trainer:telemetry', payload);
  });

  controller.on('status', (payload: StatusPayload) => {
    mainWindow?.webContents.send('trainer:status', payload);
  });

  controller.on('target-watts', (watts: number) => {
    mainWindow?.webContents.send('trainer:target', watts);
  });

  const rendererPath = path.join(__dirname, '../renderer/index.html');
  await mainWindow.loadFile(rendererPath);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
};

app.on('ready', async () => {
  await createWindow();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

app.on('window-all-closed', async () => {
  await controller.shutdown();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('trainer/connect', async (_event, options: ConnectOptions) => {
  await controller.connect(options);
  return { ok: true };
});

ipcMain.handle('trainer/start', async (_event, options: StartSessionOptions) => {
  await controller.startSession(options);
  return { ok: true };
});

ipcMain.handle('trainer/stop', async () => {
  await controller.stopSession();
  return { ok: true };
});

ipcMain.handle('trainer/setTarget', async (_event, watts: number) => {
  await controller.setTargetWatts(watts);
  return { ok: true };
});

ipcMain.handle('trainer/nudge', async (_event, delta: number) => {
  const watts = await controller.nudgeWatts(delta);
  return { ok: true, watts };
});

ipcMain.handle('trainer/shutdown', async () => {
  await controller.shutdown();
  return { ok: true };
});
