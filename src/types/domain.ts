/**
 * Domain contracts shared across main, preload, and renderer processes.
 * Times are ISO 8601 strings in UTC unless noted otherwise.
 */

export type DeviceKind = 'trainer' | 'heartRateMonitor' | 'powerMeter' | 'cadenceSensor';

export type DeviceConnectionState = 'discovered' | 'pairing' | 'paired' | 'connected' | 'disconnecting' | 'disconnected';

export type DeviceMetric =
  | 'power'
  | 'cadence'
  | 'heartRate'
  | 'speed'
  | 'resistance'
  | 'distance';

export interface DeviceSnapshot {
  id: string;
  kind: DeviceKind;
  name: string;
  identifier: string;
  signalStrength?: number;
  batteryLevel?: number;
  metrics: DeviceMetric[];
  state: DeviceConnectionState;
  preferredPowerSource?: boolean;
  lastSeenAt?: string;
  firmwareVersion?: string;
  serialNumber?: string;
}

export interface DeviceCalibrationState {
  deviceId: string;
  inProgress: boolean;
  startedAt?: string;
  completedAt?: string;
  result?: 'success' | 'failure';
  message?: string;
}

export type TrainerMode = 'erg' | 'slope' | 'level' | 'resistance';

export interface TrainerSettings {
  deviceId: string;
  mode: TrainerMode;
  targetPowerWatts?: number;
  targetSlopePercent?: number;
  resistanceLevel?: number;
  lastUpdatedAt: string;
}

export type WorkoutBlockType = 'target' | 'freeRide';

export interface WorkoutBlock {
  id: string;
  order: number;
  type: WorkoutBlockType;
  durationSeconds: number;
  targetPowerWatts?: number;
  notes?: string;
}

export interface WorkoutBlockDraft {
  id?: string;
  order?: number;
  type: WorkoutBlockType;
  durationSeconds: number;
  targetPowerWatts?: number;
  notes?: string;
}

export interface CreateWorkoutInput {
  label: string;
  description?: string;
  blocks: WorkoutBlockDraft[];
  tags?: string[];
  estimatedTss?: number;
  intensityFactor?: number;
}

export interface UpdateWorkoutInput {
  label?: string;
  description?: string;
  blocks?: WorkoutBlockDraft[];
  tags?: string[];
  estimatedTss?: number;
  intensityFactor?: number;
  updatedAt?: string;
}

export interface Workout {
  id: string;
  label: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  estimatedTss?: number;
  intensityFactor?: number;
  blocks: WorkoutBlock[];
  tags?: string[];
}

export type TrainingMode = 'freeRide' | 'guided';

export type SessionState = 'idle' | 'running' | 'paused' | 'completed' | 'aborted';

export interface SessionMetrics {
  averagePowerWatts?: number;
  normalizedPowerWatts?: number;
  kilojoules?: number;
  averageCadenceRpm?: number;
  averageHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  trainingStressScore?: number;
  intensityFactor?: number;
}

export interface SessionBlockProgress {
  blockId?: string;
  label: string;
  type: WorkoutBlockType | 'freeRide';
  targetPowerWatts?: number;
  startOffsetSeconds: number;
  durationSeconds: number;
  completedSeconds: number;
}

export interface TelemetrySample {
  timestamp: string;
  powerWatts?: number;
  cadenceRpm?: number;
  heartRateBpm?: number;
  speedKph?: number;
  distanceMeters?: number;
  trainerMode?: TrainerMode;
  resistanceLevel?: number;
}

export interface SessionRecord {
  id: string;
  mode: TrainingMode;
  state: SessionState;
  startedAt: string;
  endedAt?: string;
  workoutId?: string;
  workoutLabel?: string;
  notes?: string;
  metrics: SessionMetrics;
  blockProgress: SessionBlockProgress[];
  telemetry: TelemetrySample[];
}

export interface SessionUpsertInput extends Omit<SessionRecord, 'id'> {
  id?: string;
}

export type FitExportStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface FitExportJob {
  id: string;
  sessionId: string;
  requestedAt: string;
  completedAt?: string;
  status: FitExportStatus;
  outputPath?: string;
  errorMessage?: string;
}

export interface PersistentStoreSchema {
  version: number;
  devices: DeviceSnapshot[];
  trainerSettings: TrainerSettings[];
  workouts: Workout[];
  sessions: SessionRecord[];
  fitExports: FitExportJob[];
}
