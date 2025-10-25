import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { ConnectOptions, StartSessionOptions, TelemetryPayload, StatusPayload, DiscoveredDevice, DisconnectOptions } from '../main/trainerController';

export interface ErgApi {
  connect: (options?: ConnectOptions) => Promise<string | undefined>;
  disconnect: (options?: DisconnectOptions) => Promise<void>;
  start: (options: StartSessionOptions) => Promise<void>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  setTargetWatts: (watts: number) => Promise<void>;
  nudgeWatts: (delta: number) => Promise<number | undefined>;
  shutdown: () => Promise<void>;
  startDiscovery: () => Promise<void>;
  stopDiscovery: () => Promise<void>;
  onTelemetry: (listener: (telemetry: TelemetryPayload) => void) => () => void;
  onStatus: (listener: (status: StatusPayload) => void) => () => void;
  onTargetWatts: (listener: (watts: number) => void) => () => void;
  onDevices: (listener: (devices: DiscoveredDevice[]) => void) => () => void;
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
    const response = await ipcRenderer.invoke('trainer/connect', options ?? {});
    return response?.label as string | undefined;
  },
  async disconnect(options?: DisconnectOptions) {
    await ipcRenderer.invoke('trainer/disconnect', options ?? {});
  },
  async start(options: StartSessionOptions) {
    await ipcRenderer.invoke('trainer/start', options);
  },
  async stop() {
    await ipcRenderer.invoke('trainer/stop');
  },
  async pause() {
    await ipcRenderer.invoke('trainer/pause');
  },
  async resume() {
    await ipcRenderer.invoke('trainer/resume');
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
  async startDiscovery() {
    await ipcRenderer.invoke('trainer/startDiscovery');
  },
  async stopDiscovery() {
    await ipcRenderer.invoke('trainer/stopDiscovery');
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
  onDevices(listener: (devices: DiscoveredDevice[]) => void) {
    return registerChannel<DiscoveredDevice[]>('trainer:devices', listener);
  },
};

contextBridge.exposeInMainWorld('ergApi', api);

declare global {
  interface Window {
    ergApi: ErgApi;
  }
}
