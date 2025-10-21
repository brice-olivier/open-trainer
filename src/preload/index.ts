import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { ConnectOptions, StartSessionOptions, TelemetryPayload, StatusPayload } from '../main/trainerController';

export interface ErgApi {
  connect: (options?: ConnectOptions) => Promise<void>;
  start: (options: StartSessionOptions) => Promise<void>;
  stop: () => Promise<void>;
  setTargetWatts: (watts: number) => Promise<void>;
  nudgeWatts: (delta: number) => Promise<number | undefined>;
  shutdown: () => Promise<void>;
  onTelemetry: (listener: (telemetry: TelemetryPayload) => void) => () => void;
  onStatus: (listener: (status: StatusPayload) => void) => () => void;
  onTargetWatts: (listener: (watts: number) => void) => () => void;
}

const registerChannel = <T>(channel: string, listener: (payload: T) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, payload: T) => {
    listener(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

const api: ErgApi = {
  async connect(options?: ConnectOptions) {
    await ipcRenderer.invoke('trainer/connect', options ?? {});
  },
  async start(options: StartSessionOptions) {
    await ipcRenderer.invoke('trainer/start', options);
  },
  async stop() {
    await ipcRenderer.invoke('trainer/stop');
  },
  async setTargetWatts(watts: number) {
    await ipcRenderer.invoke('trainer/setTarget', watts);
  },
  async nudgeWatts(delta: number) {
    const response = await ipcRenderer.invoke('trainer/nudge', delta);
    return response?.watts as number | undefined;
  },
  async shutdown() {
    await ipcRenderer.invoke('trainer/shutdown');
  },
  onTelemetry(listener: (telemetry: TelemetryPayload) => void) {
    return registerChannel<TelemetryPayload>('trainer:telemetry', listener);
  },
  onStatus(listener: (status: StatusPayload) => void) {
    return registerChannel<StatusPayload>('trainer:status', listener);
  },
  onTargetWatts(listener: (watts: number) => void) {
    return registerChannel<number>('trainer:target', listener);
  },
};

contextBridge.exposeInMainWorld('ergApi', api);

declare global {
  interface Window {
    ergApi: ErgApi;
  }
}
