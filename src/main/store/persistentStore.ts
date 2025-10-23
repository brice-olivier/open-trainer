import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import {
  CreateWorkoutInput,
  PersistentStoreSchema,
  Workout,
  SessionRecord,
  FitExportJob,
  DeviceSnapshot,
  TrainerSettings,
  UpdateWorkoutInput,
  WorkoutBlockDraft,
  SessionUpsertInput,
} from '../../types/domain';

const CURRENT_SCHEMA_VERSION = 1;

const DEFAULT_STATE: PersistentStoreSchema = Object.freeze({
  version: CURRENT_SCHEMA_VERSION,
  devices: [],
  trainerSettings: [],
  workouts: [],
  sessions: [],
  fitExports: [],
} satisfies PersistentStoreSchema);

const clone = <T>(value: T): T =>
  typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;

export class PersistentStore {
  private state: PersistentStoreSchema = { ...DEFAULT_STATE };

  private writeChain: Promise<void> = Promise.resolve();

  private constructor(private readonly filePath: string) {}

  static async initialize(dataDir: string, fileName = 'store.json'): Promise<PersistentStore> {
    const storePath = path.join(dataDir, fileName);
    const store = new PersistentStore(storePath);
    await store.load();
    return store;
  }

  getState(): PersistentStoreSchema {
    return clone(this.state);
  }

  listDevices(): DeviceSnapshot[] {
    return this.state.devices.map((device) => ({ ...device }));
  }

  async upsertDevice(snapshot: DeviceSnapshot): Promise<void> {
    const index = this.state.devices.findIndex((device) => device.id === snapshot.id);
    if (index >= 0) {
      this.state.devices[index] = { ...snapshot };
    } else {
      this.state.devices.push({ ...snapshot });
    }
    await this.persist();
  }

  async removeDevice(deviceId: string): Promise<void> {
    this.state.devices = this.state.devices.filter((device) => device.id !== deviceId);
    await this.persist();
  }

  getTrainerSettings(deviceId: string): TrainerSettings | undefined {
    const settings = this.state.trainerSettings.find((entry) => entry.deviceId === deviceId);
    return settings ? { ...settings } : undefined;
  }

  async saveTrainerSettings(settings: TrainerSettings): Promise<void> {
    const index = this.state.trainerSettings.findIndex((entry) => entry.deviceId === settings.deviceId);
    if (index >= 0) {
      this.state.trainerSettings[index] = { ...settings };
    } else {
      this.state.trainerSettings.push({ ...settings });
    }
    await this.persist();
  }

  listWorkouts(): Workout[] {
    return this.state.workouts
      .map((workout) => ({ ...workout, blocks: workout.blocks.map((block) => ({ ...block })) }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  getWorkout(id: string): Workout | undefined {
    const workout = this.state.workouts.find((entry) => entry.id === id);
    if (!workout) {
      return undefined;
    }
    return {
      ...workout,
      blocks: workout.blocks.map((block) => ({ ...block })),
    };
  }

  async createWorkout(payload: CreateWorkoutInput): Promise<Workout> {
    const timestamp = new Date().toISOString();
    const normalizedBlocks = this.normalizeBlocks(payload.blocks);
    const workout: Workout = {
      id: randomUUID(),
      label: payload.label,
      description: payload.description,
      createdAt: timestamp,
      updatedAt: timestamp,
      estimatedTss: payload.estimatedTss,
      intensityFactor: payload.intensityFactor,
      tags: payload.tags ? [...payload.tags] : undefined,
      blocks: normalizedBlocks,
    };
    this.state.workouts.push(workout);
    await this.persist();
    return this.getWorkout(workout.id)!;
  }

  async updateWorkout(id: string, updates: UpdateWorkoutInput): Promise<Workout | undefined> {
    const workout = this.state.workouts.find((entry) => entry.id === id);
    if (!workout) {
      return undefined;
    }

    const nextUpdatedAt = updates.updatedAt ?? new Date().toISOString();
    workout.label = updates.label ?? workout.label;
    workout.description = updates.description ?? workout.description;
    workout.estimatedTss = updates.estimatedTss ?? workout.estimatedTss;
    workout.intensityFactor = updates.intensityFactor ?? workout.intensityFactor;
    workout.tags = updates.tags ? [...updates.tags] : workout.tags;
    if (updates.blocks) {
      workout.blocks = this.normalizeBlocks(updates.blocks);
    }
    workout.updatedAt = nextUpdatedAt;

    await this.persist();
    return this.getWorkout(id);
  }

  async deleteWorkout(id: string): Promise<boolean> {
    const initialLength = this.state.workouts.length;
    this.state.workouts = this.state.workouts.filter((entry) => entry.id !== id);
    const removed = this.state.workouts.length !== initialLength;
    if (removed) {
      await this.persist();
    }
    return removed;
  }

  listSessions(): SessionRecord[] {
    return this.state.sessions
      .map((session) => ({
        ...session,
        blockProgress: session.blockProgress.map((block) => ({ ...block })),
        telemetry: session.telemetry.map((sample) => ({ ...sample })),
      }))
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  getSession(id: string): SessionRecord | undefined {
    const session = this.state.sessions.find((entry) => entry.id === id);
    if (!session) {
      return undefined;
    }
    return {
      ...session,
      blockProgress: session.blockProgress.map((block) => ({ ...block })),
      telemetry: session.telemetry.map((sample) => ({ ...sample })),
    };
  }

  async upsertSession(payload: SessionUpsertInput): Promise<SessionRecord> {
    const id = payload.id ?? randomUUID();
    const existingIndex = this.state.sessions.findIndex((entry) => entry.id === id);
    const session: SessionRecord = {
      ...payload,
      id,
      blockProgress: payload.blockProgress.map((block) => ({ ...block })),
      telemetry: payload.telemetry.map((sample) => ({ ...sample })),
      metrics: { ...payload.metrics },
    };

    if (existingIndex >= 0) {
      this.state.sessions[existingIndex] = session;
    } else {
      this.state.sessions.push(session);
    }
    await this.persist();
    return this.getSession(id)!;
  }

  private normalizeBlocks(blocks: WorkoutBlockDraft[]): Workout['blocks'] {
    return blocks.map((block, index) => ({
      id: block.id ?? randomUUID(),
      order: block.order ?? index,
      type: block.type,
      durationSeconds: block.durationSeconds,
      targetPowerWatts: block.targetPowerWatts,
      notes: block.notes,
    }));
  }

  async deleteSession(id: string): Promise<boolean> {
    const initialLength = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((entry) => entry.id !== id);
    const removed = this.state.sessions.length !== initialLength;
    if (removed) {
      await this.persist();
    }
    return removed;
  }

  listFitExports(): FitExportJob[] {
    return this.state.fitExports.map((job) => ({ ...job }));
  }

  async upsertFitExport(job: FitExportJob): Promise<void> {
    const index = this.state.fitExports.findIndex((entry) => entry.id === job.id);
    if (index >= 0) {
      this.state.fitExports[index] = { ...job };
    } else {
      this.state.fitExports.push({ ...job });
    }
    await this.persist();
  }

  async deleteFitExport(id: string): Promise<boolean> {
    const initialLength = this.state.fitExports.length;
    this.state.fitExports = this.state.fitExports.filter((entry) => entry.id !== id);
    const removed = this.state.fitExports.length !== initialLength;
    if (removed) {
      await this.persist();
    }
    return removed;
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistentStoreSchema>;
      this.state = this.migrate(parsed);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.state = { ...DEFAULT_STATE };
        await this.persist();
        return;
      }
      throw error;
    }
  }

  private migrate(raw: Partial<PersistentStoreSchema>): PersistentStoreSchema {
    if (!raw.version) {
      return { ...DEFAULT_STATE };
    }
    // Placeholder for future schema migrations.
    return {
      version: CURRENT_SCHEMA_VERSION,
      devices: raw.devices?.map((device) => ({ ...device })) ?? [],
      trainerSettings: raw.trainerSettings?.map((settings) => ({ ...settings })) ?? [],
      workouts:
        raw.workouts?.map((workout) => ({
          ...workout,
          blocks: workout.blocks?.map((block) => ({ ...block })) ?? [],
        })) ?? [],
      sessions:
        raw.sessions?.map((session) => ({
          ...session,
          blockProgress: session.blockProgress?.map((block) => ({ ...block })) ?? [],
          telemetry: session.telemetry?.map((sample) => ({ ...sample })) ?? [],
          metrics: { ...session.metrics },
        })) ?? [],
      fitExports: raw.fitExports?.map((job) => ({ ...job })) ?? [],
    };
  }

  private async persist(): Promise<void> {
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, payload, 'utf8');
    });
    await this.writeChain;
  }
}

export default PersistentStore;
