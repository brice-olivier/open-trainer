interface SessionBlock {
  id: number;
  durationSec: number;
  targetWatts: number;
}

interface MetricStats {
  powerSum: number;
  powerSamples: number;
  cadenceSum: number;
  cadenceSamples: number;
  speedSum: number;
  speedSamples: number;
}

interface DiscoveredDevice {
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

const createMetricStats = (): MetricStats => ({
  powerSum: 0,
  powerSamples: 0,
  cadenceSum: 0,
  cadenceSamples: 0,
  speedSum: 0,
  speedSamples: 0,
});

const rescanDevicesButton = document.getElementById('rescanDevices') as HTMLButtonElement | null;
const statusMessage = document.getElementById('statusMessage') as HTMLParagraphElement | null;
const connectionStateLabel = document.getElementById('connectionState') as HTMLParagraphElement | null;
const connectionDot = document.getElementById('connectionDot') as HTMLSpanElement | null;
const deviceListElement = document.getElementById('deviceList') as HTMLUListElement | null;

const blockDurationInput = document.getElementById('blockDuration') as HTMLInputElement | null;
const blockWattsInput = document.getElementById('blockWatts') as HTMLInputElement | null;
const addBlockButton = document.getElementById('addBlock') as HTMLButtonElement | null;
const clearBlocksButton = document.getElementById('clearBlocks') as HTMLButtonElement | null;
const blockListElement = document.getElementById('blockList') as HTMLUListElement | null;
const totalDurationLabel = document.getElementById('totalDuration') as HTMLSpanElement | null;

const currentBlockLabel = document.getElementById('currentBlockLabel') as HTMLSpanElement | null;
const currentBlockRemaining = document.getElementById('currentBlockRemaining') as HTMLSpanElement | null;
const sessionRemainingLabel = document.getElementById('sessionRemaining') as HTMLSpanElement | null;
const blockProgressBar = document.getElementById('blockProgress') as HTMLDivElement | null;
const sessionProgressBar = document.getElementById('sessionProgress') as HTMLDivElement | null;

const targetInput = document.getElementById('targetWatts') as HTMLInputElement | null;
const durationInput = document.getElementById('duration') as HTMLInputElement | null;
const startButton = document.getElementById('start') as HTMLButtonElement | null;
const pauseButton = document.getElementById('pause') as HTMLButtonElement | null;
const stopButton = document.getElementById('stop') as HTMLButtonElement | null;
const increaseButton = document.getElementById('increase') as HTMLButtonElement | null;
const decreaseButton = document.getElementById('decrease') as HTMLButtonElement | null;
const currentTargetLabel = document.getElementById('currentTarget') as HTMLSpanElement | null;

const telemetryPower = document.getElementById('telemetryPower') as HTMLParagraphElement | null;
const telemetryCadence = document.getElementById('telemetryCadence') as HTMLParagraphElement | null;
const telemetrySpeed = document.getElementById('telemetrySpeed') as HTMLParagraphElement | null;

const avgPowerElem = document.getElementById('avgPower') as HTMLParagraphElement | null;
const avgCadenceElem = document.getElementById('avgCadence') as HTMLParagraphElement | null;
const avgSpeedElem = document.getElementById('avgSpeed') as HTMLParagraphElement | null;
const blockAvgPowerElem = document.getElementById('blockAvgPower') as HTMLParagraphElement | null;
const blockAvgCadenceElem = document.getElementById('blockAvgCadence') as HTMLParagraphElement | null;
const blockAvgSpeedElem = document.getElementById('blockAvgSpeed') as HTMLParagraphElement | null;

const eventLog = document.getElementById('eventLog') as HTMLUListElement | null;

let blocks: SessionBlock[] = [];
let blockCounter = 0;

let sessionActive = false;
let structuredSession = false;
let sessionPaused = false;
let discoveredDevices: DiscoveredDevice[] = [];
let deviceScanning = false;
let connectedDeviceId: string | null = null;
let currentBlockIndex = -1;
let sessionStartTime = 0;
let blockStartTime = 0;
let sessionElapsedMs = 0;
let blockElapsedMs = 0;
let blockTimer: ReturnType<typeof setTimeout> | null = null;
let progressInterval: ReturnType<typeof setInterval> | null = null;

const overallStats = createMetricStats();
let blockStats: MetricStats[] = [];

let lastStatusMessage = '';
let lastConnected = false;
let lastRunning = false;

const formatNumber = (value?: number, unit = ''): string => {
  if (value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return `${value.toFixed(1)}${unit}`.replace('.0', '');
};

const formatSeconds = (seconds: number): string => {
  const clamped = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const setStatus = (text: string): void => {
  if (statusMessage) {
    statusMessage.textContent = text;
  }
};

const setConnectionState = (stateLabel: string, stateClass: 'idle' | 'scanning' | 'connected' | 'running'): void => {
  if (connectionStateLabel) {
    connectionStateLabel.textContent = stateLabel;
  }
  if (!connectionDot) return;

  connectionDot.className = 'status-dot';
  switch (stateClass) {
    case 'running':
      connectionDot.classList.add('running');
      break;
    case 'connected':
      connectionDot.classList.add('connected');
      break;
    case 'scanning':
      connectionDot.classList.add('scanning');
      break;
    default:
      connectionDot.classList.add('offline');
      break;
  }
};

const appendLog = (message: string): void => {
  if (!eventLog) return;

  if (eventLog.firstElementChild && eventLog.firstElementChild.classList.contains('placeholder')) {
    eventLog.innerHTML = '';
  }

  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} – ${message}`;
  eventLog.prepend(item);

  while (eventLog.children.length > 25) {
    eventLog.removeChild(eventLog.lastElementChild as Node);
  }
};

const getTotalDurationSec = (): number => blocks.reduce((acc, block) => acc + block.durationSec, 0);

const resetStats = (): void => {
  overallStats.powerSum = 0;
  overallStats.powerSamples = 0;
  overallStats.cadenceSum = 0;
  overallStats.cadenceSamples = 0;
  overallStats.speedSum = 0;
  overallStats.speedSamples = 0;
  blockStats = blocks.map(() => createMetricStats());
  updateMetricsDisplay();
};

const updateMetricsDisplay = (): void => {
  const formatAvg = (sum: number, samples: number, suffix: string, decimals = 0): string => {
    if (!samples) return '—';
    const value = sum / samples;
    return `${value.toFixed(decimals)} ${suffix}`;
  };

  if (avgPowerElem) avgPowerElem.textContent = formatAvg(overallStats.powerSum, overallStats.powerSamples, 'W');
  if (avgCadenceElem) avgCadenceElem.textContent = formatAvg(overallStats.cadenceSum, overallStats.cadenceSamples, 'rpm');
  if (avgSpeedElem) avgSpeedElem.textContent = formatAvg(overallStats.speedSum, overallStats.speedSamples, 'km/h', 1);

  if (structuredSession && currentBlockIndex >= 0 && blockStats[currentBlockIndex]) {
    const stats = blockStats[currentBlockIndex];
    if (blockAvgPowerElem) blockAvgPowerElem.textContent = formatAvg(stats.powerSum, stats.powerSamples, 'W');
    if (blockAvgCadenceElem) blockAvgCadenceElem.textContent = formatAvg(stats.cadenceSum, stats.cadenceSamples, 'rpm');
    if (blockAvgSpeedElem) blockAvgSpeedElem.textContent = formatAvg(stats.speedSum, stats.speedSamples, 'km/h', 1);
  } else {
    if (blockAvgPowerElem) blockAvgPowerElem.textContent = '—';
    if (blockAvgCadenceElem) blockAvgCadenceElem.textContent = '—';
    if (blockAvgSpeedElem) blockAvgSpeedElem.textContent = '—';
  }
};

const renderBlocks = (): void => {
  if (!blockListElement) return;

  if (!blocks.length) {
    blockListElement.innerHTML = '<li class="placeholder">No blocks yet. Add blocks to build your session.</li>';
  } else {
    blockListElement.innerHTML = '';
    blocks.forEach((block, index) => {
      const item = document.createElement('li');
      if (structuredSession && sessionActive && index === currentBlockIndex) {
        item.classList.add('active');
      }
      item.dataset.id = block.id.toString();
      const minutes = block.durationSec / 60;
      item.innerHTML = `
        <div>
          <strong>Block ${index + 1}</strong> – ${formatSeconds(block.durationSec)} @ ${block.targetWatts} W
        </div>
        <button class="ghost" data-remove="${block.id}" aria-label="Remove block">✕</button>
      `;
      blockListElement.appendChild(item);
    });
  }

  if (totalDurationLabel) {
    totalDurationLabel.textContent = formatSeconds(getTotalDurationSec());
  }
};

const getDeviceKindLabel = (device: DiscoveredDevice): string => {
  switch (device.kind) {
    case 'trainer':
      return 'Trainer';
    case 'heart-rate':
      return 'Heart rate';
    default:
      return 'Bluetooth device';
  }
};

const formatRssi = (value?: number): string | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }
  return `${value} dBm`;
};

const renderDeviceList = (): void => {
  if (!deviceListElement) return;

  if (!discoveredDevices.length) {
    const placeholder = deviceScanning ? 'Scanning for Bluetooth devices…' : 'No devices found. Try rescan.';
    deviceListElement.innerHTML = `<li class="placeholder">${placeholder}</li>`;
    return;
  }

  deviceListElement.innerHTML = '';
  discoveredDevices.forEach((device) => {
    const item = document.createElement('li');
    item.className = 'device-item';
    const isConnected = device.connected || (connectedDeviceId !== null && device.id === connectedDeviceId);
    if (isConnected) {
      item.classList.add('connected');
    }

    const info = document.createElement('div');

    const labelElem = document.createElement('p');
    labelElem.className = 'device-label';
    labelElem.textContent = device.label;

    const metaElem = document.createElement('p');
    metaElem.className = 'device-meta';
    const metaParts: string[] = [getDeviceKindLabel(device)];
    const rssiText = formatRssi(device.rssi);
    if (rssiText) {
      metaParts.push(rssiText);
    }
    metaElem.textContent = metaParts.join(' • ');

    info.appendChild(labelElem);
    info.appendChild(metaElem);

    const action = document.createElement('button');
    action.type = 'button';
    const supportsConnect = device.kind === 'trainer';
    action.className = isConnected ? 'danger small device-action' : 'small device-action';
    action.dataset.deviceId = device.id;
    if (supportsConnect || isConnected) {
      action.dataset.deviceAction = isConnected ? 'disconnect' : 'connect';
      action.textContent = isConnected ? 'Disconnect' : 'Connect';
      if (!isConnected && !device.connectable) {
        action.disabled = true;
      }
    } else {
      action.className = 'ghost small device-action';
      action.textContent = 'Unavailable';
      action.disabled = true;
    }

    item.appendChild(info);
    item.appendChild(action);
    deviceListElement.appendChild(item);
  });
};

const updateTargetLabel = (watts: number): void => {
  if (currentTargetLabel) {
    currentTargetLabel.textContent = `Target: ${Math.round(watts)} W`;
  }
  if (targetInput) {
    targetInput.value = String(Math.round(watts));
  }
};

const updateButtons = (connected: boolean, running: boolean): void => {
  const hasSession = sessionActive || sessionPaused;
  if (startButton) {
    startButton.disabled = !connected;
    if (sessionPaused && !running) {
      startButton.textContent = 'Restart';
    } else {
      startButton.textContent = running ? 'Restart' : 'Start';
    }
  }
  if (pauseButton) {
    pauseButton.disabled = !connected || !hasSession || (!running && !sessionPaused);
    pauseButton.textContent = sessionPaused ? 'Resume' : 'Pause';
  }
  if (stopButton) stopButton.disabled = !connected || !hasSession;
  if (increaseButton) increaseButton.disabled = !connected;
  if (decreaseButton) decreaseButton.disabled = !connected;
};

const updateBlockUI = (): void => {
  if (currentBlockIndex >= 0 && blocks[currentBlockIndex]) {
    const block = blocks[currentBlockIndex];
    if (currentBlockLabel) {
      currentBlockLabel.textContent = `Block ${currentBlockIndex + 1} of ${blocks.length} – ${formatSeconds(block.durationSec)} @ ${block.targetWatts} W`;
    }
  } else if (currentBlockLabel) {
    currentBlockLabel.textContent = '—';
  }
};

const updateProgress = (): void => {
  const totalDurationSec = getTotalDurationSec();
  const activeBlock = currentBlockIndex >= 0 ? blocks[currentBlockIndex] : undefined;

  if (!structuredSession || !activeBlock || totalDurationSec === 0) {
    if (sessionProgressBar) sessionProgressBar.style.width = '0%';
    if (blockProgressBar) blockProgressBar.style.width = '0%';
    if (currentBlockRemaining) currentBlockRemaining.textContent = '—';
    if (sessionRemainingLabel) sessionRemainingLabel.textContent = structuredSession && totalDurationSec > 0 ? formatSeconds(totalDurationSec) : '—';
    return;
  }

  const now = Date.now();
  let elapsedSessionSec = sessionElapsedMs / 1000;
  if (sessionActive && !sessionPaused && sessionStartTime) {
    elapsedSessionSec += (now - sessionStartTime) / 1000;
  }
  elapsedSessionSec = Math.min(totalDurationSec, Math.max(0, elapsedSessionSec));

  if (sessionProgressBar) {
    const sessionPercent = Math.min(100, (elapsedSessionSec / totalDurationSec) * 100);
    sessionProgressBar.style.width = `${sessionPercent}%`;
  }
  if (sessionRemainingLabel) {
    sessionRemainingLabel.textContent = formatSeconds(Math.max(0, totalDurationSec - elapsedSessionSec));
  }

  let elapsedBlockSec = blockElapsedMs / 1000;
  if (sessionActive && !sessionPaused && blockStartTime) {
    elapsedBlockSec += (now - blockStartTime) / 1000;
  }
  elapsedBlockSec = Math.min(activeBlock.durationSec, Math.max(0, elapsedBlockSec));

  if (blockProgressBar) {
    const blockPercent = Math.min(100, (elapsedBlockSec / activeBlock.durationSec) * 100);
    blockProgressBar.style.width = `${blockPercent}%`;
  }
  if (currentBlockRemaining) {
    currentBlockRemaining.textContent = formatSeconds(Math.max(0, activeBlock.durationSec - elapsedBlockSec));
  }
};

const clearTimers = (): void => {
  if (blockTimer) {
    clearTimeout(blockTimer);
    blockTimer = null;
  }
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
};

function advanceToNextBlock(): void {
  const nextIndex = currentBlockIndex + 1;
  if (nextIndex < blocks.length) {
    activateBlock(nextIndex);
  } else {
    endStructuredSession('Structured session complete');
  }
}

function scheduleBlockTimer(delayMs: number): void {
  if (blockTimer) {
    clearTimeout(blockTimer);
  }
  blockTimer = setTimeout(advanceToNextBlock, delayMs);
}

const endStructuredSession = (reason?: string): void => {
  if (!sessionActive && !structuredSession) return;

  clearTimers();
  if (reason) {
    appendLog(reason);
  }

  sessionActive = false;
  structuredSession = false;
  sessionPaused = false;
  currentBlockIndex = -1;
  sessionStartTime = 0;
  blockStartTime = 0;
  sessionElapsedMs = 0;
  blockElapsedMs = 0;
  updateProgress();
  updateBlockUI();
  renderBlocks();
  updateMetricsDisplay();
  updateButtons(lastConnected, false);
};

const activateBlock = (index: number): void => {
  if (!structuredSession || !blocks[index]) return;

  sessionPaused = false;
  currentBlockIndex = index;
  blockStartTime = Date.now();
  blockElapsedMs = 0;
  updateBlockUI();
  renderBlocks();

  if (blockStats[index]) {
    blockStats[index] = createMetricStats();
  }

  const block = blocks[index];
  void window.ergApi.setTargetWatts(block.targetWatts).catch((error: unknown) => {
    console.error(error);
    setStatus(`Failed to set target: ${(error as Error).message}`);
    appendLog(`Failed to set target: ${(error as Error).message}`);
  });
  updateTargetLabel(block.targetWatts);
  appendLog(`Block ${index + 1}/${blocks.length}: ${formatSeconds(block.durationSec)} @ ${block.targetWatts} W`);

  scheduleBlockTimer(block.durationSec * 1000);

  updateProgress();
};

const startStructuredSession = (): void => {
  if (!blocks.length) return;

  clearTimers();
  structuredSession = true;
  sessionActive = true;
  sessionPaused = false;
  sessionStartTime = Date.now();
  sessionElapsedMs = 0;
  blockElapsedMs = 0;
  currentBlockIndex = -1;
  resetStats();

  if (progressInterval) {
    clearInterval(progressInterval);
  }
  progressInterval = setInterval(updateProgress, 1000);

  activateBlock(0);
};

const handleBuilderUpdate = (): void => {
  renderBlocks();
  updateProgress();
};

addBlockButton?.addEventListener('click', () => {
  if (structuredSession) {
    setStatus('Stop the session to modify blocks.');
    return;
  }

  const durationMinutes = Number(blockDurationInput?.value ?? 0);
  const targetWatts = Number(blockWattsInput?.value ?? 0);

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    setStatus('Enter a duration greater than zero.');
    return;
  }
  if (!Number.isFinite(targetWatts) || targetWatts < 0) {
    setStatus('Enter a valid wattage.');
    return;
  }

  blocks.push({
    id: ++blockCounter,
    durationSec: Math.max(1, Math.round(durationMinutes * 60)),
    targetWatts: Math.round(targetWatts),
  });

  appendLog(`Added block: ${durationMinutes} min @ ${Math.round(targetWatts)} W`);
  handleBuilderUpdate();
});

clearBlocksButton?.addEventListener('click', () => {
  if (structuredSession) {
    setStatus('Stop the session to modify blocks.');
    return;
  }
  if (!blocks.length) return;
  blocks = [];
  appendLog('Cleared all session blocks');
  handleBuilderUpdate();
});

blockListElement?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const removeId = target.getAttribute('data-remove');
  if (!removeId) return;

  if (structuredSession) {
    setStatus('Stop the session to modify blocks.');
    return;
  }

  const id = Number(removeId);
  blocks = blocks.filter((block) => block.id !== id);
  appendLog(`Removed block ${id}`);
  handleBuilderUpdate();
});

deviceListElement?.addEventListener('click', async (event) => {
  const target = (event.target as HTMLElement).closest('button[data-device-action]') as HTMLButtonElement | null;
  if (!target) return;

  event.preventDefault();

  const deviceId = target.dataset.deviceId;
  const action = target.dataset.deviceAction;
  if (!deviceId || !action) return;

  const device = discoveredDevices.find((entry) => entry.id === deviceId);
  const friendlyLabel = device?.label ?? deviceId;
  const originalText = target.textContent ?? '';

  target.disabled = true;

  if (action === 'connect') {
    target.textContent = 'Connecting…';
    setConnectionState('Scanning', 'scanning');
    setStatus(`Connecting to ${friendlyLabel}…`);
    appendLog(`Connecting to ${friendlyLabel}`);
    try {
      const connectionLabel = await window.ergApi.connect({ deviceId });
      const labelText = (connectionLabel && connectionLabel.trim()) || friendlyLabel;
      setStatus(`Connected. Control acquired (${labelText}).`);
      setConnectionState('Connected', 'connected');
      appendLog(`Connected to trainer (${labelText})`);
      deviceScanning = true;
      renderDeviceList();
      await window.ergApi.startDiscovery().catch(() => undefined);
    } catch (error) {
      console.error(error);
      setStatus(`Failed to connect: ${(error as Error).message}`);
      setConnectionState('Idle', 'idle');
      appendLog(`Connection failed: ${(error as Error).message}`);
    }
  } else if (action === 'disconnect') {
    target.textContent = 'Disconnecting…';
    setStatus('Disconnecting…');
    appendLog('Disconnecting from trainer');
    try {
      await window.ergApi.disconnect();
      deviceScanning = true;
      renderDeviceList();
      await window.ergApi.startDiscovery().catch(() => undefined);
    } catch (error) {
      console.error(error);
      setStatus(`Failed to disconnect: ${(error as Error).message}`);
      appendLog(`Failed to disconnect: ${(error as Error).message}`);
    }
  }

  target.textContent = originalText;
  target.disabled = false;
});

rescanDevicesButton?.addEventListener('click', async () => {
  if (rescanDevicesButton) rescanDevicesButton.disabled = true;
  deviceScanning = true;
  discoveredDevices = [];
  renderDeviceList();
  try {
    await window.ergApi.stopDiscovery();
  } catch (error) {
    console.error(error);
  }
  try {
    await window.ergApi.startDiscovery();
  } catch (error) {
    console.error(error);
    setStatus(`Failed to start scan: ${(error as Error).message}`);
    appendLog(`Discovery failed: ${(error as Error).message}`);
  } finally {
    if (rescanDevicesButton) rescanDevicesButton.disabled = false;
  }
});

startButton?.addEventListener('click', async () => {
  try {
    const hasBlocks = blocks.length > 0;
    if (hasBlocks) {
      const totalDurationSec = getTotalDurationSec();
      const firstTarget = blocks[0].targetWatts;
      await window.ergApi.start({
        targetWatts: firstTarget,
        durationSeconds: totalDurationSec > 0 ? totalDurationSec : undefined,
      });
      appendLog(`Structured session started (${blocks.length} blocks, ${formatSeconds(totalDurationSec)})`);
      startStructuredSession();
      lastConnected = true;
      lastRunning = true;
      updateButtons(true, true);
    } else {
      const watts = Number(targetInput?.value ?? 0);
      const manualDuration = Number(durationInput?.value ?? 0);
      await window.ergApi.start({
        targetWatts: watts,
        durationSeconds: manualDuration > 0 ? manualDuration : undefined,
      });
      clearTimers();
      resetStats();
      sessionActive = true;
      structuredSession = false;
      sessionPaused = false;
      sessionStartTime = Date.now();
      blockStartTime = 0;
      sessionElapsedMs = 0;
      blockElapsedMs = 0;
      updateProgress();
      lastConnected = true;
      lastRunning = true;
      updateButtons(true, true);
      appendLog(`Manual ERG started @ ${Math.round(watts)} W${manualDuration > 0 ? ` for ${manualDuration}s` : ''}`);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Failed to start session: ${(error as Error).message}`);
    appendLog(`Failed to start session: ${(error as Error).message}`);
  }
});

pauseButton?.addEventListener('click', async () => {
  if (!sessionActive && !sessionPaused) {
    setStatus('No active session to pause.');
    return;
  }

  if (sessionPaused) {
    try {
      await window.ergApi.resume();
      sessionPaused = false;
      sessionActive = true;
      sessionStartTime = Date.now();
      if (structuredSession && currentBlockIndex >= 0 && blocks[currentBlockIndex]) {
        const block = blocks[currentBlockIndex];
        const remainingMs = Math.max(0, block.durationSec * 1000 - blockElapsedMs);
        if (remainingMs <= 0) {
          blockElapsedMs = 0;
          advanceToNextBlock();
        } else {
          blockStartTime = Date.now();
          scheduleBlockTimer(remainingMs);
        }
      }
      if (structuredSession && !progressInterval) {
        progressInterval = setInterval(updateProgress, 1000);
      }
      lastRunning = true;
      updateButtons(lastConnected, true);
      updateProgress();
      appendLog('ERG session resumed');
    } catch (error) {
      console.error(error);
      setStatus(`Failed to resume session: ${(error as Error).message}`);
      appendLog(`Failed to resume session: ${(error as Error).message}`);
    }
    return;
  }

  try {
    await window.ergApi.pause();
    const now = Date.now();
    if (sessionActive && sessionStartTime) {
      sessionElapsedMs += now - sessionStartTime;
      sessionStartTime = 0;
    }
    if (structuredSession && currentBlockIndex >= 0 && blockStartTime) {
      blockElapsedMs += now - blockStartTime;
      blockStartTime = 0;
    }
    sessionPaused = true;
    lastRunning = false;
    clearTimers();
    updateProgress();
    updateButtons(lastConnected, false);
    appendLog('ERG session paused');
  } catch (error) {
    console.error(error);
    setStatus(`Failed to pause session: ${(error as Error).message}`);
    appendLog(`Failed to pause session: ${(error as Error).message}`);
  }
});

stopButton?.addEventListener('click', async () => {
  try {
    await window.ergApi.stop();
    endStructuredSession('ERG session stopped');
  } catch (error) {
    console.error(error);
    setStatus(`Failed to stop: ${(error as Error).message}`);
    appendLog(`Failed to stop: ${(error as Error).message}`);
  }
});

increaseButton?.addEventListener('click', async () => {
  try {
    const watts = await window.ergApi.nudgeWatts(10);
    if (typeof watts === 'number') {
      updateTargetLabel(watts);
      appendLog(`Target increased to ${watts} W`);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Failed to adjust watts: ${(error as Error).message}`);
    appendLog(`Failed to adjust watts: ${(error as Error).message}`);
  }
});

decreaseButton?.addEventListener('click', async () => {
  try {
    const watts = await window.ergApi.nudgeWatts(-10);
    if (typeof watts === 'number') {
      updateTargetLabel(watts);
      appendLog(`Target decreased to ${watts} W`);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Failed to adjust watts: ${(error as Error).message}`);
    appendLog(`Failed to adjust watts: ${(error as Error).message}`);
  }
});

window.ergApi.onDevices((devices) => {
  discoveredDevices = devices;
  const active = devices.find((device) => device.connected);
  if (active) {
    connectedDeviceId = active.id;
  }
  renderDeviceList();
});

window.ergApi.onTelemetry((telemetry) => {
  if (telemetryPower) telemetryPower.textContent = formatNumber(telemetry.powerWatts, ' W');
  if (telemetryCadence) telemetryCadence.textContent = formatNumber(telemetry.cadenceRpm, ' rpm');
  if (telemetrySpeed) telemetrySpeed.textContent = formatNumber(telemetry.speedKph, ' km/h');

  if (typeof telemetry.powerWatts === 'number') {
    overallStats.powerSum += telemetry.powerWatts;
    overallStats.powerSamples += 1;
    if (structuredSession && sessionActive && currentBlockIndex >= 0 && blockStats[currentBlockIndex]) {
      const stats = blockStats[currentBlockIndex];
      stats.powerSum += telemetry.powerWatts;
      stats.powerSamples += 1;
    }
  }
  if (typeof telemetry.cadenceRpm === 'number') {
    overallStats.cadenceSum += telemetry.cadenceRpm;
    overallStats.cadenceSamples += 1;
    if (structuredSession && sessionActive && currentBlockIndex >= 0 && blockStats[currentBlockIndex]) {
      const stats = blockStats[currentBlockIndex];
      stats.cadenceSum += telemetry.cadenceRpm;
      stats.cadenceSamples += 1;
    }
  }
  if (typeof telemetry.speedKph === 'number') {
    overallStats.speedSum += telemetry.speedKph;
    overallStats.speedSamples += 1;
    if (structuredSession && sessionActive && currentBlockIndex >= 0 && blockStats[currentBlockIndex]) {
      const stats = blockStats[currentBlockIndex];
      stats.speedSum += telemetry.speedKph;
      stats.speedSamples += 1;
    }
  }

  updateMetricsDisplay();
  updateProgress();
});

window.ergApi.onStatus((status) => {
  const stateLabel = status.running
    ? 'Running'
    : status.connected
      ? 'Connected'
      : status.scanning
        ? 'Scanning'
        : 'Idle';
  const stateClass = status.running
    ? 'running'
    : status.connected
      ? 'connected'
      : status.scanning
        ? 'scanning'
        : 'idle';

  const message = status.message ? `${stateLabel} — ${status.message}` : stateLabel;
  setStatus(message);
  setConnectionState(stateLabel, stateClass);
  sessionPaused = Boolean(status.paused);
  deviceScanning = Boolean(status.scanning);
  if (status.connected && typeof status.deviceId === 'string') {
    connectedDeviceId = status.deviceId;
  } else if (!status.connected) {
    connectedDeviceId = null;
  }
  renderDeviceList();
  updateButtons(status.connected, status.running);

  lastConnected = status.connected;
  lastRunning = status.running;

  if (!status.connected && sessionActive) {
    endStructuredSession('Trainer disconnected');
  }

  if (message !== lastStatusMessage) {
    appendLog(message);
    lastStatusMessage = message;
  }
});

window.ergApi.onTargetWatts((watts) => {
  updateTargetLabel(watts);
});

updateTargetLabel(Number(targetInput?.value ?? 0));
deviceScanning = true;
renderDeviceList();
void window.ergApi.startDiscovery().catch((error: unknown) => {
  console.error(error);
  setStatus(`Failed to start discovery: ${(error as Error).message}`);
  appendLog(`Discovery failed: ${(error as Error).message}`);
  deviceScanning = false;
  renderDeviceList();
});
window.addEventListener('beforeunload', () => {
  void window.ergApi.stopDiscovery();
});
updateButtons(false, false);
setConnectionState('Idle', 'idle');
renderBlocks();
updateProgress();
updateMetricsDisplay();
