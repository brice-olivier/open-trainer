import EventEmitter from 'events';
import noble, {
  Characteristic,
  Peripheral,
} from '@abandonware/noble';

export interface ConnectOptions {
  deviceName?: string;
  timeoutMs?: number;
  deviceId?: string;
  deviceKind?: 'trainer' | 'heart-rate';
}

export interface StartSessionOptions {
  targetWatts: number;
  durationSeconds?: number;
}

export interface DisconnectOptions {
  deviceId?: string;
  deviceKind?: 'trainer' | 'heart-rate';
}

export interface TelemetryPayload {
  speedKph?: number;
  cadenceRpm?: number;
  powerWatts?: number;
  heartRateBpm?: number;
}

export interface StatusPayload {
  connected: boolean;
  controlling: boolean;
  running: boolean;
  scanning: boolean;
  deviceId?: string;
  paused?: boolean;
  message?: string;
}

const FTMS_SERVICE_UUID = '1826';
const FTMS_CONTROL_POINT_UUID = '2ad9';
const FTMS_INDOOR_BIKE_UUID = '2ad2';
const FTMS_STATUS_UUID = '2ada';
const HEART_RATE_SERVICE_UUID = '180d';
const HEART_RATE_MEASUREMENT_UUID = '2a37';
const DEVICE_STALE_MS = 15000;

const FTMS_REQUEST_CONTROL = 0x00;
const FTMS_RESET = 0x01;
const FTMS_SET_TARGET_POWER = 0x05;
const FTMS_START_RESUME = 0x07;
const FTMS_STOP_PAUSE = 0x08;

// Flags from FTMS Indoor bike data characteristic, see Bluetooth SIG spec.
const FTMS_FLAG_MORE_DATA = 1 << 0;
const FTMS_FLAG_AVG_SPEED_PRESENT = 1 << 1;
const FTMS_FLAG_INST_CADENCE_PRESENT = 1 << 2;
const FTMS_FLAG_AVG_CADENCE_PRESENT = 1 << 3;
const FTMS_FLAG_TOTAL_DISTANCE_PRESENT = 1 << 4;
const FTMS_FLAG_RESISTANCE_LEVEL_PRESENT = 1 << 5;
const FTMS_FLAG_INST_POWER_PRESENT = 1 << 6;
const FTMS_FLAG_AVG_POWER_PRESENT = 1 << 7;
const FTMS_FLAG_EXPENDED_ENERGY_PRESENT = 1 << 8;
const FTMS_FLAG_HEART_RATE_PRESENT = 1 << 9;
const FTMS_FLAG_MET_EQUIPMENT_PRESENT = 1 << 10;
const FTMS_FLAG_ELAPSED_TIME_PRESENT = 1 << 11;
const FTMS_FLAG_REMAINING_TIME_PRESENT = 1 << 12;

export interface DiscoveredDevice {
  id: string;
  label: string;
  name?: string;
  identifier?: string;
  services: string[];
  rssi?: number;
  kind: 'trainer' | 'heart-rate' | 'unknown';
  connectable: boolean;
  connected: boolean;
  lastSeen: number;
}

export class TrainerController extends EventEmitter {
  private static formatIdentifier(raw?: string): string | undefined {
    if (!raw) return undefined;
    const cleaned = raw.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    if (!cleaned) return undefined;
    const tail = cleaned.slice(-6);
    if (tail.length < 4) {
      return cleaned.toUpperCase();
    }
    const segments = tail.match(/.{1,2}/g);
    if (!segments) {
      return tail.toUpperCase();
    }
    return segments.join(':').toUpperCase();
  }

  private static buildDeviceLabel(peripheral: Peripheral): string {
    const advertisedName = (peripheral.advertisement?.localName || '').trim();
    const identifier = TrainerController.formatIdentifier(peripheral.uuid || peripheral.id);
    const parts: string[] = [];
    parts.push(advertisedName || `FTMS service ${FTMS_SERVICE_UUID}`);
    if (identifier) {
      parts.push(identifier);
    }
    return parts.join(' • ');
  }

  private peripheral?: Peripheral;

  private indoorBikeCharacteristic?: Characteristic;

  private controlPointCharacteristic?: Characteristic;

  private statusCharacteristic?: Characteristic;

  private heartRatePeripheral?: Peripheral;

  private heartRateCharacteristic?: Characteristic;

  private isControlling = false;

  private isRunning = false;

  private sessionTimer?: NodeJS.Timeout;

  private sessionTimerStartedAt?: number;

  private sessionTimerRemainingMs?: number;

  private currentTargetWatts = 0;

  private isPaused = false;

  private connectedDeviceLabel?: string;

  private connectedDeviceId?: string;

  private connectedHeartRateId?: string;

  private readonly discoveredPeripherals = new Map<string, Peripheral>();

  private readonly discoveredDevices = new Map<string, DiscoveredDevice>();

  private discovering = false;

  private readonly handleDiscoverBound = this.handleDiscover.bind(this);

  async connect(options: ConnectOptions = {}): Promise<string | undefined> {
    const kind = this.resolveDeviceKind(options.deviceId, options.deviceKind);
    if (kind === 'heart-rate') {
      return this.connectHeartRate(options);
    }

    if (this.peripheral) {
      this.emitStatus({ message: 'Trainer already connected' });
      return this.connectedDeviceLabel;
    }

    const { deviceId } = options;
    if (deviceId) {
      const known = this.discoveredPeripherals.get(deviceId);
      if (known) {
        await this.stopDiscovery().catch(() => undefined);
        await this.bindPeripheral(known);
        return this.connectedDeviceLabel;
      }
    }

    if (noble._state === 'poweredOn') {
      await this.scanAndConnect(options);
    } else {
      await new Promise<void>((resolve, reject) => {
        const handleState = async (state: string) => {
          if (state === 'poweredOn') {
            noble.removeListener('stateChange', handleState);
            try {
              await this.scanAndConnect(options);
              resolve();
            } catch (error) {
              reject(error);
            }
          } else if (state === 'unsupported' || state === 'unauthorized') {
            reject(new Error(`Bluetooth adapter state ${state}`));
          }
        };
        noble.on('stateChange', handleState);
      });
    }

    return this.connectedDeviceLabel;
  }

  private async connectHeartRate(options: ConnectOptions): Promise<string | undefined> {
    if (this.heartRatePeripheral && this.connectedHeartRateId) {
      return this.discoveredDevices.get(this.connectedHeartRateId)?.label;
    }

    const { deviceId } = options;
    if (!deviceId) {
      throw new Error('Heart rate monitor deviceId is required');
    }
    const peripheral = this.discoveredPeripherals.get(deviceId);
    if (!peripheral) {
      throw new Error('Heart rate monitor not found');
    }

    await this.stopDiscovery().catch(() => undefined);
    await this.bindHeartRatePeripheral(peripheral);
    return this.discoveredDevices.get(deviceId)?.label ?? TrainerController.buildDeviceLabel(peripheral);
  }

  private async disconnectHeartRate(): Promise<void> {
    if (!this.heartRatePeripheral) {
      return;
    }
    const peripheral = this.heartRatePeripheral;
    try {
      if (peripheral.state === 'connected' || peripheral.state === 'connecting') {
        await peripheral.disconnectAsync();
      }
    } catch (error) {
      // ignore disconnect errors
    }
  }

  async startDiscovery(): Promise<void> {
    if (this.discovering) {
      this.emitDevices();
      return;
    }

    const begin = async (): Promise<void> => {
      this.discovering = true;
      for (const id of [...this.discoveredDevices.keys()]) {
        if (id !== this.connectedDeviceId && id !== this.connectedHeartRateId) {
          this.discoveredDevices.delete(id);
          this.discoveredPeripherals.delete(id);
        }
      }
      this.emitDevices();
      noble.removeListener('discover', this.handleDiscoverBound);
      noble.on('discover', this.handleDiscoverBound);
      try {
        await noble.startScanningAsync([], true);
        this.emitStatus({ scanning: true, message: 'Scanning for devices' });
      } catch (error) {
        noble.removeListener('discover', this.handleDiscoverBound);
        this.discovering = false;
        throw error;
      }
    };

    if (noble._state === 'poweredOn') {
      await begin();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const handleState = async (state: string) => {
        if (state === 'poweredOn') {
          noble.removeListener('stateChange', handleState);
          try {
            await begin();
            resolve();
          } catch (error) {
            reject(error);
          }
        } else if (state === 'unsupported' || state === 'unauthorized') {
          reject(new Error(`Bluetooth adapter state ${state}`));
        }
      };
      noble.on('stateChange', handleState);
    });
  }

  async stopDiscovery(): Promise<void> {
    if (!this.discovering) return;
    this.discovering = false;
    noble.removeListener('discover', this.handleDiscoverBound);
    try {
      await noble.stopScanningAsync();
    } catch (error) {
      // ignore stop scanning errors
    }
    this.emitStatus({ scanning: false });
  }

  async startSession(options: StartSessionOptions): Promise<void> {
    await this.ensureConnected();
    const { targetWatts, durationSeconds } = options;
    await this.requestControl();
    await this.setTargetWatts(targetWatts);
    await this.startOrResume();
    this.isRunning = true;
    this.isPaused = false;
    this.sessionTimerRemainingMs = durationSeconds && durationSeconds > 0 ? durationSeconds * 1000 : undefined;
    this.scheduleSessionTimer();
    this.emitStatus({ message: 'ERG session running', running: true, controlling: this.isControlling, paused: false });
  }

  async stopSession(): Promise<void> {
    if (!this.peripheral || !this.controlPointCharacteristic) {
      return;
    }

    await this.writeControlPoint(Buffer.from([FTMS_STOP_PAUSE]));
    this.isRunning = false;
    this.isPaused = false;
    this.sessionTimerRemainingMs = undefined;
    this.clearSessionTimer();
    this.emitStatus({ message: 'ERG session stopped', running: false, controlling: this.isControlling, paused: false });
  }

  async disconnect(options: DisconnectOptions = {}): Promise<void> {
    const kind = this.resolveDeviceKind(options.deviceId, options.deviceKind);
    if (kind === 'heart-rate') {
      await this.disconnectHeartRate();
      return;
    }

    if (!this.peripheral) {
      return;
    }
    try {
      await this.stopSession();
    } catch (error) {
      // ignore stop errors during disconnect
    }
    if (this.peripheral && this.peripheral.state === 'connected') {
      try {
        await this.peripheral.disconnectAsync();
      } catch (error) {
        // ignore disconnect errors
      }
    }
  }

  async pauseSession(): Promise<void> {
    if (!this.peripheral || !this.controlPointCharacteristic) {
      return;
    }
    if (!this.isRunning) {
      return;
    }

    await this.writeControlPoint(Buffer.from([FTMS_STOP_PAUSE]));
    this.isRunning = false;
    this.isPaused = true;
    if (this.sessionTimerStartedAt && typeof this.sessionTimerRemainingMs === 'number') {
      const elapsed = Date.now() - this.sessionTimerStartedAt;
      this.sessionTimerRemainingMs = Math.max(0, this.sessionTimerRemainingMs - elapsed);
    }
    this.clearSessionTimer();
    this.emitStatus({ message: 'ERG session paused', running: false, controlling: this.isControlling, paused: true });
  }

  async resumeSession(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    await this.ensureConnected();
    await this.requestControl();
    await this.startOrResume();
    this.isRunning = true;
    this.isPaused = false;
    this.scheduleSessionTimer();
    this.emitStatus({ message: 'ERG session running', running: true, controlling: this.isControlling, paused: false });
  }

  async setTargetWatts(watts: number): Promise<void> {
    await this.ensureConnected();
    await this.requestControl();
    const safeWatts = Math.max(0, Math.min(Math.round(watts), 2500));
    const payload = Buffer.alloc(3);
    payload.writeUInt8(FTMS_SET_TARGET_POWER, 0);
    payload.writeInt16LE(safeWatts, 1);
    await this.writeControlPoint(payload);
    this.currentTargetWatts = safeWatts;
    this.emit('target-watts', safeWatts);
  }

  async nudgeWatts(delta: number): Promise<number> {
    const updated = this.currentTargetWatts + delta;
    await this.setTargetWatts(updated);
    return this.currentTargetWatts;
  }

  async shutdown(): Promise<void> {
    await this.stopDiscovery().catch(() => undefined);
    this.clearSessionTimer();
    this.sessionTimerRemainingMs = undefined;
    if (this.peripheral) {
      try {
        await this.writeControlPoint(Buffer.from([FTMS_STOP_PAUSE]));
      } catch (error) {
        // ignore errors during shutdown
      }
      try {
        await this.writeControlPoint(Buffer.from([FTMS_RESET]));
      } catch (error) {
        // ignore errors during shutdown
      }
    }
    await this.disconnect({ deviceKind: 'heart-rate' }).catch(() => undefined);
    await this.disconnect();
    this.isControlling = false;
    this.isRunning = false;
    this.isPaused = false;
    if (!this.peripheral) {
      this.connectedDeviceLabel = undefined;
      this.connectedDeviceId = undefined;
    }
    this.discoveredPeripherals.clear();
    this.discoveredDevices.clear();
    this.heartRatePeripheral = undefined;
    this.heartRateCharacteristic = undefined;
    this.connectedHeartRateId = undefined;
    this.emitDevices();
  }

  private async ensureConnected(): Promise<void> {
    if (!this.peripheral) {
      await this.connect();
    }
  }

  private async scanAndConnect(options: ConnectOptions): Promise<void> {
    const { deviceName, timeoutMs = 20000, deviceId } = options;

    await this.stopDiscovery().catch(() => undefined);

    await new Promise<void>((resolve, reject) => {
      const stopScanning = async () => {
        try {
          await noble.stopScanningAsync();
        } catch (error) {
          // ignore stop scanning errors
        }
        this.emitStatus({ scanning: false });
      };

      const timeoutHandle = setTimeout(() => {
        noble.removeListener('discover', onDiscover);
        void stopScanning();
        reject(new Error('Timed out searching for FTMS trainer'));
      }, timeoutMs);

      const onDiscover = async (peripheral: Peripheral) => {
        const advertisement = peripheral.advertisement;
        const services = advertisement.serviceUuids || [];
        const lowerServices = services.map((s) => s.toLowerCase());
        const matchesService = lowerServices.includes(FTMS_SERVICE_UUID);
        const matchesName = !deviceName || (advertisement.localName || '').toLowerCase().includes(deviceName.toLowerCase());
        const id = this.getPeripheralId(peripheral);
        const matchesId = !deviceId || id === deviceId;

        this.handleDiscover(peripheral);

        if (!matchesService || !matchesName || !matchesId) {
          return;
        }

        noble.removeListener('discover', onDiscover);
        clearTimeout(timeoutHandle);

        try {
          await stopScanning();
          await this.bindPeripheral(peripheral);
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      noble.on('discover', onDiscover);

      noble.startScanningAsync([FTMS_SERVICE_UUID], false).catch((error) => {
        clearTimeout(timeoutHandle);
        noble.removeListener('discover', onDiscover);
        reject(error);
      });

      this.emitStatus({ scanning: true, message: 'Scanning for trainer' });
    });
  }

  private async bindPeripheral(peripheral: Peripheral): Promise<void> {
    const id = this.getPeripheralId(peripheral);
    this.peripheral = peripheral;
    this.connectedDeviceLabel = TrainerController.buildDeviceLabel(peripheral);
    this.connectedDeviceId = id;
    this.discoveredPeripherals.set(id, peripheral);
    this.handleDiscover(peripheral);

    peripheral.once('disconnect', () => {
      const disconnectedLabel = this.connectedDeviceLabel;
      this.peripheral = undefined;
      this.controlPointCharacteristic = undefined;
      this.indoorBikeCharacteristic = undefined;
      this.statusCharacteristic = undefined;
      this.isControlling = false;
      this.isRunning = false;
      this.isPaused = false;
      this.sessionTimerRemainingMs = undefined;
      this.clearSessionTimer();
      this.connectedDeviceLabel = undefined;
      this.connectedDeviceId = undefined;
      this.emitDevices();
      const message = disconnectedLabel ? `Trainer disconnected (${disconnectedLabel})` : 'Trainer disconnected';
      this.emitStatus({ message, connected: false, controlling: false, running: false, paused: false });
    });

    await peripheral.connectAsync();

    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [FTMS_SERVICE_UUID],
      [FTMS_CONTROL_POINT_UUID, FTMS_INDOOR_BIKE_UUID, FTMS_STATUS_UUID],
    );

    characteristics.forEach((characteristic) => {
      const uuid = characteristic.uuid.toLowerCase();
      if (uuid === FTMS_CONTROL_POINT_UUID) {
        this.controlPointCharacteristic = characteristic;
      } else if (uuid === FTMS_INDOOR_BIKE_UUID) {
        this.indoorBikeCharacteristic = characteristic;
      } else if (uuid === FTMS_STATUS_UUID) {
        this.statusCharacteristic = characteristic;
      }
    });

    if (!this.controlPointCharacteristic || !this.indoorBikeCharacteristic) {
      throw new Error('Trainer does not expose required FTMS characteristics');
    }

    await this.subscribe(this.indoorBikeCharacteristic, this.handleIndoorBikeNotification);
    await this.subscribe(this.controlPointCharacteristic, this.handleControlPointNotification);
    if (this.statusCharacteristic) {
      await this.subscribe(this.statusCharacteristic, this.handleStatusNotification);
    }

    await this.writeControlPoint(Buffer.from([FTMS_REQUEST_CONTROL]));
    this.isControlling = true;
    const message = this.connectedDeviceLabel ? `Trainer connected (${this.connectedDeviceLabel})` : 'Trainer connected';
    this.emitStatus({ message, connected: true, controlling: true });
    this.emitDevices();
  }

  private async bindHeartRatePeripheral(peripheral: Peripheral): Promise<void> {
    const id = this.getPeripheralId(peripheral);
    this.discoveredPeripherals.set(id, peripheral);
    this.handleDiscover(peripheral);

    await peripheral.connectAsync();

    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [HEART_RATE_SERVICE_UUID],
      [HEART_RATE_MEASUREMENT_UUID],
    );

    const measurement = characteristics.find(
      (characteristic) => characteristic.uuid.toLowerCase() === HEART_RATE_MEASUREMENT_UUID,
    );

    if (!measurement) {
      await peripheral.disconnectAsync().catch(() => undefined);
      throw new Error('Heart rate monitor does not expose required characteristics');
    }

    this.heartRatePeripheral = peripheral;
    this.heartRateCharacteristic = measurement;
    this.connectedHeartRateId = id;

    peripheral.once('disconnect', () => {
      this.heartRatePeripheral = undefined;
      this.heartRateCharacteristic = undefined;
      const disconnectedId = this.connectedHeartRateId;
      this.connectedHeartRateId = undefined;
      this.emitDevices();
      const label = disconnectedId ? this.discoveredDevices.get(disconnectedId)?.label : undefined;
      const message = label ? `Heart rate monitor disconnected (${label})` : 'Heart rate monitor disconnected';
      this.emitStatus({ message });
    });

    await this.subscribe(measurement, this.handleHeartRateNotification);
    this.emitDevices();
    const label = this.discoveredDevices.get(id)?.label ?? TrainerController.buildDeviceLabel(peripheral);
    const message = `Heart rate monitor connected${label ? ` (${label})` : ''}`;
    this.emitStatus({ message });
  }

  private async subscribe(characteristic: Characteristic, listener: (data: Buffer) => void): Promise<void> {
    characteristic.removeAllListeners('data');
    characteristic.on('data', (data: Buffer) => listener.call(this, data));
    await new Promise<void>((resolve, reject) => {
      characteristic.subscribe((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async requestControl(): Promise<void> {
    if (this.isControlling) {
      return;
    }
    await this.ensureConnected();
    await this.writeControlPoint(Buffer.from([FTMS_REQUEST_CONTROL]));
    this.isControlling = true;
    this.emitStatus({ controlling: true, connected: true, running: this.isRunning });
  }

  private async startOrResume(): Promise<void> {
    await this.writeControlPoint(Buffer.from([FTMS_START_RESUME]));
  }

  private handleIndoorBikeNotification(data: Buffer): void {
    if (data.length < 2) {
      return;
    }
    const telemetry: TelemetryPayload = {};
    let offset = 0;
    const flags = data.readUInt16LE(offset);
    offset += 2;

    if (!(flags & FTMS_FLAG_MORE_DATA)) {
      const speedRaw = data.readUInt16LE(offset);
      offset += 2;
      telemetry.speedKph = speedRaw / 100;
    }

    if (flags & FTMS_FLAG_AVG_SPEED_PRESENT) {
      offset += 2;
    }

    if (flags & FTMS_FLAG_INST_CADENCE_PRESENT) {
      const cadenceRaw = data.readUInt16LE(offset);
      offset += 2;
      telemetry.cadenceRpm = cadenceRaw / 2;
    }

    if (flags & FTMS_FLAG_AVG_CADENCE_PRESENT) {
      offset += 2;
    }

    if (flags & FTMS_FLAG_TOTAL_DISTANCE_PRESENT) {
      offset += 3;
    }

    if (flags & FTMS_FLAG_RESISTANCE_LEVEL_PRESENT) {
      offset += 2;
    }

    if (flags & FTMS_FLAG_INST_POWER_PRESENT) {
      const powerRaw = data.readInt16LE(offset);
      offset += 2;
      telemetry.powerWatts = powerRaw;
    }

    if (flags & FTMS_FLAG_AVG_POWER_PRESENT) {
      offset += 2;
    }

    if (flags & FTMS_FLAG_EXPENDED_ENERGY_PRESENT) {
      offset += 5;
    }

    if (flags & FTMS_FLAG_HEART_RATE_PRESENT && offset < data.length) {
      telemetry.heartRateBpm = data.readUInt8(offset);
      offset += 1;
    }

    if (flags & FTMS_FLAG_MET_EQUIPMENT_PRESENT) {
      offset += 1;
    }

    if (flags & FTMS_FLAG_ELAPSED_TIME_PRESENT) {
      offset += 2;
    }

    if (flags & FTMS_FLAG_REMAINING_TIME_PRESENT) {
      offset += 2;
    }

    this.emit('telemetry', telemetry);
  }

  private handleHeartRateNotification(data: Buffer): void {
    if (!data.length) {
      return;
    }
    const flags = data.readUInt8(0);
    let offset = 1;

    let heartRate: number | undefined;
    if (flags & 0x01) {
      if (data.length >= offset + 2) {
        heartRate = data.readUInt16LE(offset);
        offset += 2;
      }
    } else if (data.length >= offset + 1) {
      heartRate = data.readUInt8(offset);
      offset += 1;
    }

    if (typeof heartRate === 'number' && Number.isFinite(heartRate)) {
      this.emit('telemetry', { heartRateBpm: heartRate });
    }
  }

  private handleControlPointNotification(data: Buffer): void {
    if (data.length < 3) {
      return;
    }
    const responseCode = data.readUInt8(0);
    if (responseCode !== 0x80) {
      return;
    }
    const requestOpcode = data.readUInt8(1);
    const result = data.readUInt8(2);

    let message: string | undefined;
    if (result !== 0x01) {
      message = `Control point response for opcode 0x${requestOpcode.toString(16)} returned status 0x${result.toString(16)}`;
    }

    if (message) {
      this.emitStatus({ message, connected: true, controlling: this.isControlling, running: this.isRunning });
    }
  }

  private handleStatusNotification(data: Buffer): void {
    if (!data.length) {
      return;
    }
    const statusOpCode = data.readUInt8(0);
    if (statusOpCode === 0x14) {
      this.emitStatus({ message: 'Trainer acknowledged simulation parameter change', connected: true, controlling: this.isControlling, running: this.isRunning });
    }
  }

  private async writeControlPoint(buffer: Buffer): Promise<void> {
    if (!this.controlPointCharacteristic) {
      throw new Error('Control point not ready');
    }
    await new Promise<void>((resolve, reject) => {
      this.controlPointCharacteristic!.write(buffer, false, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private resolveDeviceKind(deviceId?: string, explicitKind?: 'trainer' | 'heart-rate'): 'trainer' | 'heart-rate' {
    if (explicitKind) {
      return explicitKind;
    }
    if (deviceId) {
      if (deviceId === this.connectedHeartRateId) {
        return 'heart-rate';
      }
      const known = this.discoveredDevices.get(deviceId);
      if (known?.kind === 'heart-rate') {
        return 'heart-rate';
      }
      if (known?.kind === 'trainer') {
        return 'trainer';
      }
    }
    return 'trainer';
  }

  private getPeripheralId(peripheral: Peripheral): string {
    return peripheral.id ?? peripheral.uuid;
  }

  private handleDiscover(peripheral: Peripheral): void {
    const id = this.getPeripheralId(peripheral);
    this.discoveredPeripherals.set(id, peripheral);

    const serviceUuids = (peripheral.advertisement?.serviceUuids || []).map((uuid) => uuid.toLowerCase());
    let kind: DiscoveredDevice['kind'] = 'unknown';
    if (serviceUuids.includes(FTMS_SERVICE_UUID)) {
      kind = 'trainer';
    } else if (serviceUuids.includes(HEART_RATE_SERVICE_UUID)) {
      kind = 'heart-rate';
    }

    const label = TrainerController.buildDeviceLabel(peripheral);
    const name = (peripheral.advertisement?.localName || '').trim() || undefined;
    const identifier = TrainerController.formatIdentifier(peripheral.uuid || peripheral.id);

    const device: DiscoveredDevice = {
      id,
      label,
      name,
      identifier,
      services: serviceUuids,
      rssi: typeof peripheral.rssi === 'number' ? peripheral.rssi : undefined,
      kind,
      connectable: peripheral.connectable ?? true,
      connected: id === this.connectedDeviceId || id === this.connectedHeartRateId,
      lastSeen: Date.now(),
    };

    this.discoveredDevices.set(id, device);
    this.emitDevices();
  }

  private emitDevices(): void {
    const now = Date.now();
    for (const [id, device] of [...this.discoveredDevices.entries()]) {
      if (id !== this.connectedDeviceId && id !== this.connectedHeartRateId && now - device.lastSeen > DEVICE_STALE_MS) {
        this.discoveredDevices.delete(id);
      }
    }

    const devices = Array.from(this.discoveredDevices.values())
      .map((device) => ({
        ...device,
        connected: device.id === this.connectedDeviceId || device.id === this.connectedHeartRateId,
      }))
      .sort((a, b) => {
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        if (a.kind !== b.kind) {
          if (a.kind === 'trainer') return -1;
          if (b.kind === 'trainer') return 1;
          if (a.kind === 'heart-rate') return -1;
          if (b.kind === 'heart-rate') return 1;
        }
        if (a.label !== b.label) return a.label.localeCompare(b.label);
        return 0;
      });

    this.emit('devices', devices);
  }

  private clearSessionTimer(): void {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = undefined;
    }
    this.sessionTimerStartedAt = undefined;
  }

  private scheduleSessionTimer(): void {
    this.clearSessionTimer();
    if (!this.sessionTimerRemainingMs || this.sessionTimerRemainingMs <= 0) {
      this.sessionTimerRemainingMs = undefined;
      return;
    }
    this.sessionTimerStartedAt = Date.now();
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = undefined;
      this.sessionTimerRemainingMs = undefined;
      this.sessionTimerStartedAt = undefined;
      void this.stopSession();
    }, this.sessionTimerRemainingMs);
  }

  private emitStatus(partial: Partial<StatusPayload>): void {
    const payload: StatusPayload = {
      connected: Boolean(this.peripheral),
      controlling: this.isControlling,
      running: this.isRunning,
      scanning: this.discovering,
      message: partial.message,
      paused: this.isPaused,
      deviceId: this.connectedDeviceId,
    };

    if (typeof partial.connected === 'boolean') {
      payload.connected = partial.connected;
    }
    if (typeof partial.controlling === 'boolean') {
      payload.controlling = partial.controlling;
    }
    if (typeof partial.running === 'boolean') {
      payload.running = partial.running;
    }
    if (typeof partial.scanning === 'boolean') {
      payload.scanning = partial.scanning;
    }
    if (typeof partial.paused === 'boolean') {
      payload.paused = partial.paused;
    }
    if (typeof partial.deviceId === 'string') {
      payload.deviceId = partial.deviceId;
    }

    this.emit('status', payload);
  }
}

export default TrainerController;
