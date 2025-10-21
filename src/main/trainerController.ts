import EventEmitter from 'events';
import noble, {
  Characteristic,
  Peripheral,
} from '@abandonware/noble';

export interface ConnectOptions {
  deviceName?: string;
  timeoutMs?: number;
}

export interface StartSessionOptions {
  targetWatts: number;
  durationSeconds?: number;
}

export interface TelemetryPayload {
  speedKph?: number;
  cadenceRpm?: number;
  powerWatts?: number;
}

export interface StatusPayload {
  connected: boolean;
  controlling: boolean;
  running: boolean;
  scanning: boolean;
  message?: string;
}

const FTMS_SERVICE_UUID = '1826';
const FTMS_CONTROL_POINT_UUID = '2ad9';
const FTMS_INDOOR_BIKE_UUID = '2ad2';
const FTMS_STATUS_UUID = '2ada';

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

export class TrainerController extends EventEmitter {
  private peripheral?: Peripheral;

  private indoorBikeCharacteristic?: Characteristic;

  private controlPointCharacteristic?: Characteristic;

  private statusCharacteristic?: Characteristic;

  private isControlling = false;

  private isRunning = false;

  private sessionTimer?: NodeJS.Timeout;

  private currentTargetWatts = 0;

  async connect(options: ConnectOptions = {}): Promise<void> {
    if (this.peripheral) {
      this.emitStatus({ message: 'Trainer already connected' });
      return;
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
  }

  async startSession(options: StartSessionOptions): Promise<void> {
    await this.ensureConnected();
    const { targetWatts, durationSeconds } = options;
    await this.requestControl();
    await this.setTargetWatts(targetWatts);
    await this.startOrResume();
    this.isRunning = true;
    this.emitStatus({ message: 'ERG session running', running: true, controlling: this.isControlling });

    if (durationSeconds && durationSeconds > 0) {
      if (this.sessionTimer) {
        clearTimeout(this.sessionTimer);
      }
      this.sessionTimer = setTimeout(() => {
        void this.stopSession();
      }, durationSeconds * 1000);
    }
  }

  async stopSession(): Promise<void> {
    if (!this.peripheral || !this.controlPointCharacteristic) {
      return;
    }

    await this.writeControlPoint(Buffer.from([FTMS_STOP_PAUSE]));
    this.isRunning = false;
    this.emitStatus({ message: 'ERG session stopped', running: false, controlling: this.isControlling });
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
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
    }
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
      this.peripheral.removeAllListeners('disconnect');
      if (this.peripheral.state === 'connected') {
        await this.peripheral.disconnectAsync();
      }
      this.peripheral = undefined;
    }
    this.isControlling = false;
    this.isRunning = false;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.peripheral) {
      await this.connect();
    }
  }

  private async scanAndConnect(options: ConnectOptions): Promise<void> {
    const { deviceName, timeoutMs = 20000 } = options;

    await new Promise<void>((resolve, reject) => {
      const stopScanning = async () => {
        try {
          await noble.stopScanningAsync();
        } catch (error) {
          // ignore stop scanning errors
        }
      };

      const timeoutHandle = setTimeout(() => {
        noble.removeListener('discover', onDiscover);
        void stopScanning();
        reject(new Error('Timed out searching for FTMS trainer'));
      }, timeoutMs);

      const onDiscover = async (peripheral: Peripheral) => {
        const advertisement = peripheral.advertisement;
        const services = advertisement.serviceUuids || [];
        const matchesService = services.map((s) => s.toLowerCase()).includes(FTMS_SERVICE_UUID);
        const matchesName = !deviceName || (advertisement.localName || '').toLowerCase().includes(deviceName.toLowerCase());

        if (!matchesService || !matchesName) {
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
    });
  }

  private async bindPeripheral(peripheral: Peripheral): Promise<void> {
    this.peripheral = peripheral;

    peripheral.once('disconnect', () => {
      this.peripheral = undefined;
      this.controlPointCharacteristic = undefined;
      this.indoorBikeCharacteristic = undefined;
      this.statusCharacteristic = undefined;
      this.isControlling = false;
      this.isRunning = false;
      this.emitStatus({ message: 'Trainer disconnected', connected: false, controlling: false, running: false });
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
    this.emitStatus({ message: 'Trainer connected', connected: true, controlling: true });
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

    if (flags & FTMS_FLAG_HEART_RATE_PRESENT) {
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

  private emitStatus(partial: Partial<StatusPayload>): void {
    const payload: StatusPayload = {
      connected: Boolean(this.peripheral),
      controlling: this.isControlling,
      running: this.isRunning,
      scanning: false,
      message: partial.message,
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

    this.emit('status', payload);
  }
}

export default TrainerController;
