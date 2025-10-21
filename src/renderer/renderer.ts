const deviceInput = document.getElementById('deviceName') as HTMLInputElement | null;
const connectButton = document.getElementById('connect') as HTMLButtonElement | null;
const statusMessage = document.getElementById('statusMessage') as HTMLParagraphElement | null;
const targetInput = document.getElementById('targetWatts') as HTMLInputElement | null;
const durationInput = document.getElementById('duration') as HTMLInputElement | null;
const startButton = document.getElementById('start') as HTMLButtonElement | null;
const stopButton = document.getElementById('stop') as HTMLButtonElement | null;
const increaseButton = document.getElementById('increase') as HTMLButtonElement | null;
const decreaseButton = document.getElementById('decrease') as HTMLButtonElement | null;
const currentTargetLabel = document.getElementById('currentTarget') as HTMLSpanElement | null;
const telemetryPower = document.getElementById('telemetryPower') as HTMLSpanElement | null;
const telemetryCadence = document.getElementById('telemetryCadence') as HTMLSpanElement | null;
const telemetrySpeed = document.getElementById('telemetrySpeed') as HTMLSpanElement | null;

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

const setTargetLabel = (watts: number): void => {
  if (currentTargetLabel) {
    currentTargetLabel.textContent = `Target: ${Math.round(watts)} W`;
  }
  if (targetInput) {
    targetInput.value = String(Math.round(watts));
  }
};

const handleButtonState = (connected: boolean, running: boolean): void => {
  if (startButton) startButton.disabled = !connected;
  if (stopButton) stopButton.disabled = !connected;
  if (increaseButton) increaseButton.disabled = !connected;
  if (decreaseButton) decreaseButton.disabled = !connected;
  if (connectButton) connectButton.disabled = connected;

  if (startButton) {
    startButton.textContent = running ? 'Restart' : 'Start';
  }
};

connectButton?.addEventListener('click', async () => {
  try {
    connectButton.disabled = true;
    setStatus('Connecting...');
    const filter = deviceInput?.value.trim();
    await window.ergApi.connect(filter ? { deviceName: filter } : {});
    setStatus('Connected. Control acquired.');
  } catch (error) {
    console.error(error);
    setStatus(`Failed to connect: ${(error as Error).message}`);
    connectButton.disabled = false;
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
  } catch (error) {
    console.error(error);
    setStatus(`Failed to start session: ${(error as Error).message}`);
  }
});

stopButton?.addEventListener('click', async () => {
  try {
    await window.ergApi.stop();
  } catch (error) {
    console.error(error);
    setStatus(`Failed to stop: ${(error as Error).message}`);
  }
});

increaseButton?.addEventListener('click', async () => {
  try {
    const watts = await window.ergApi.nudgeWatts(10);
    if (typeof watts === 'number') {
      setTargetLabel(watts);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Failed to adjust watts: ${(error as Error).message}`);
  }
});

decreaseButton?.addEventListener('click', async () => {
  try {
    const watts = await window.ergApi.nudgeWatts(-10);
    if (typeof watts === 'number') {
      setTargetLabel(watts);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Failed to adjust watts: ${(error as Error).message}`);
  }
});

window.ergApi.onTelemetry((telemetry) => {
  if (telemetryPower) telemetryPower.textContent = formatNumber(telemetry.powerWatts, ' W');
  if (telemetryCadence) telemetryCadence.textContent = formatNumber(telemetry.cadenceRpm, ' rpm');
  if (telemetrySpeed) telemetrySpeed.textContent = formatNumber(telemetry.speedKph, ' km/h');
});

window.ergApi.onStatus((status) => {
  const prefix = status.running ? 'Running' : status.connected ? 'Connected' : status.scanning ? 'Scanning' : 'Idle';
  const message = status.message ? `${prefix} – ${status.message}` : prefix;
  setStatus(message);
  handleButtonState(status.connected, status.running);
});

window.ergApi.onTargetWatts((watts) => {
  setTargetLabel(watts);
});

setTargetLabel(Number(targetInput?.value ?? 0));
handleButtonState(false, false);
