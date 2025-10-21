const deviceInput = document.getElementById('deviceName') as HTMLInputElement | null;
const connectButton = document.getElementById('connect') as HTMLButtonElement | null;
const statusMessage = document.getElementById('statusMessage') as HTMLParagraphElement | null;
const connectionStateLabel = document.getElementById('connectionState') as HTMLParagraphElement | null;
const connectionDot = document.getElementById('connectionDot') as HTMLSpanElement | null;

const targetInput = document.getElementById('targetWatts') as HTMLInputElement | null;
const durationInput = document.getElementById('duration') as HTMLInputElement | null;
const startButton = document.getElementById('start') as HTMLButtonElement | null;
const stopButton = document.getElementById('stop') as HTMLButtonElement | null;
const increaseButton = document.getElementById('increase') as HTMLButtonElement | null;
const decreaseButton = document.getElementById('decrease') as HTMLButtonElement | null;
const currentTargetLabel = document.getElementById('currentTarget') as HTMLSpanElement | null;

const telemetryPower = document.getElementById('telemetryPower') as HTMLParagraphElement | null;
const telemetryCadence = document.getElementById('telemetryCadence') as HTMLParagraphElement | null;
const telemetrySpeed = document.getElementById('telemetrySpeed') as HTMLParagraphElement | null;

const eventLog = document.getElementById('eventLog') as HTMLUListElement | null;

let lastStatusMessage = '';

const formatNumber = (value?: number, unit = ''): string => {
  if (value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return `${value.toFixed(1)}${unit}`.replace('.0', '');
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

  // keep the last 25 entries
  while (eventLog.children.length > 25) {
    eventLog.removeChild(eventLog.lastElementChild as Node);
  }
};

const setTargetLabel = (watts: number): void => {
  if (currentTargetLabel) {
    currentTargetLabel.textContent = `Target: ${Math.round(watts)} W`;
  }
  if (targetInput) {
    targetInput.value = String(Math.round(watts));
  }
};

const updateButtons = (connected: boolean, running: boolean): void => {
  if (startButton) startButton.disabled = !connected;
  if (stopButton) stopButton.disabled = !connected;
  if (increaseButton) increaseButton.disabled = !connected;
  if (decreaseButton) decreaseButton.disabled = !connected;
  if (connectButton) connectButton.disabled = connected;

  if (startButton) startButton.textContent = running ? 'Restart' : 'Start';
};

connectButton?.addEventListener('click', async () => {
  try {
    if (connectButton) connectButton.disabled = true;
    setConnectionState('Scanning', 'scanning');
    setStatus('Connecting…');

    const filter = deviceInput?.value.trim();
    await window.ergApi.connect(filter ? { deviceName: filter } : {});

    setStatus('Connected. Control acquired.');
    setConnectionState('Connected', 'connected');
    appendLog('Connected to trainer');
  } catch (error) {
    console.error(error);
    setStatus(`Failed to connect: ${(error as Error).message}`);
    setConnectionState('Idle', 'idle');
    if (connectButton) connectButton.disabled = false;
    appendLog(`Connection failed: ${(error as Error).message}`);
  }
});

startButton?.addEventListener('click', async () => {
  try {
    const watts = Number(targetInput?.value ?? 0);
    const durationSeconds = Number(durationInput?.value ?? 0);
    await window.ergApi.start({
      targetWatts: watts,
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined,
    });
    appendLog(`ERG session started @ ${Math.round(watts)} W${durationSeconds ? ` for ${durationSeconds}s` : ''}`);
  } catch (error) {
    console.error(error);
    setStatus(`Failed to start session: ${(error as Error).message}`);
    appendLog(`Failed to start session: ${(error as Error).message}`);
  }
});

stopButton?.addEventListener('click', async () => {
  try {
    await window.ergApi.stop();
    appendLog('ERG session stopped');
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
      setTargetLabel(watts);
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
      setTargetLabel(watts);
      appendLog(`Target decreased to ${watts} W`);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Failed to adjust watts: ${(error as Error).message}`);
    appendLog(`Failed to adjust watts: ${(error as Error).message}`);
  }
});

window.ergApi.onTelemetry((telemetry) => {
  if (telemetryPower) telemetryPower.textContent = formatNumber(telemetry.powerWatts, ' W');
  if (telemetryCadence) telemetryCadence.textContent = formatNumber(telemetry.cadenceRpm, ' rpm');
  if (telemetrySpeed) telemetrySpeed.textContent = formatNumber(telemetry.speedKph, ' km/h');
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
  updateButtons(status.connected, status.running);

  if (message !== lastStatusMessage) {
    appendLog(message);
    lastStatusMessage = message;
  }
});

window.ergApi.onTargetWatts((watts) => {
  setTargetLabel(watts);
});

setTargetLabel(Number(targetInput?.value ?? 0));
updateButtons(false, false);
setConnectionState('Idle', 'idle');
