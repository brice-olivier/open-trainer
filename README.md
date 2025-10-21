# ERG Trainer POC

Minimal Electron + TypeScript proof of concept that connects to a Bluetooth FTMS home trainer (for example an Elite Suito) and drives it in ERG mode. The UI lets you:

- Connect to the first FTMS device in range (optionally filtered by name).
- Start an ERG session for a target wattage and optional duration.
- Stop the session at any time.
- Nudge the target watts up/down without restarting.
- Watch live telemetry for power, cadence, and speed.

> **Important:** This repository is a proof of concept. Error handling is intentionally simple and the BLE stack relies on the experimental `@abandonware/noble` package. Use at your own risk and start with low watt targets when testing.

## Prerequisites

- macOS with Bluetooth Low Energy hardware (the Mac mini M4 works out of the box).
- [Node.js 20+](https://nodejs.org/en/download) installed (`brew install node` is the quickest path on macOS).
- Permissions to use Bluetooth (grant the app access when macOS prompts).

## Getting started

```bash
cd erg-trainer-poc
npm install
npm start
```

`npm start` builds the TypeScript sources, copies the static assets, and launches Electron. The renderer loads `src/renderer/index.html`, so any UI tweaks are hot-reloaded when you restart the app.

### Development mode

For iterative work with automatic compilation:

```bash
npm run dev
```

This runs TypeScript in watch mode, copies renderer assets on change, and relaunches Electron after the first build completes.

## Usage notes

1. **Connect:** Optionally enter part of your trainer’s Bluetooth name (e.g. “suito”) and click **Connect**. The app scans for FTMS devices for up to 20 seconds.
2. **Start:** Adjust the desired watts and optional duration (seconds). Press **Start** to send the request-control, target-power, and start commands.
3. **Adjust:** Use **+10 W** / **–10 W** to nudge the current target without interrupting the session.
4. **Stop:** Hit **Stop** to send the FTMS stop/pause opcode. The trainer should fall back to freewheel mode.

Telemetry updates appear in the **Live Telemetry** card. All power values are capped between 0 W and 2500 W for safety.

## Known limitations

- No ANT+ FE‑C support—BLE FTMS only.
- No persistence of preferred trainer or last target watt.
- BLE reconnection logic is minimal; if the trainer drops out you may need to relaunch.
- This environment did not have Node.js available during authoring, so the code is untested locally. Run `npm start` after installing dependencies to verify everything on your machine.

Contributions, bug reports, and enhancements are welcome. Start by exploring `src/main/trainerController.ts` to adjust FTMS behaviour or extend telemetry parsing.
