# Repository Guidelines

## Project Structure & Module Organization
- `src/main/` runs the Electron main process and FTMS orchestration.
- Device discovery and targeted connection logic lives in `src/main/trainerController.ts` (`startDiscovery`, `connect({ deviceId })`, `devices` events). Keep BLE scanning concerns there.
- `src/preload/` defines the IPC surface exposed to the renderer—extend it rather than using Node APIs directly.
- `src/renderer/` holds the dashboard (`index.html`, `renderer.ts`, `styles.css`); keep it browser-safe.
- `src/types/` stores shared contracts. Build output lives in `dist/`; avoid manual edits.

## Build, Test, and Development Commands
- `npm install` – install dependencies.
- `npm start` – compile once, copy assets, and launch Electron.
- `npm run dev` – watch-mode build pipeline with automatic reload.
- `npm run build` – emit the distributable bundle into `dist/`.
- `npm run lint` – run `tsc --noEmit` for type-level linting.

## Coding Style & Naming Conventions
- Strict TypeScript is enforced; resolve compiler warnings before committing.
- Use two-space indentation, trailing commas on multi-line literals, and prefer `const` until reassignment is needed.
- camelCase variables/functions, PascalCase types/interfaces, and kebab-case filenames (e.g. `trainer-controller.ts`).
- Renderer code must stay sandboxed; route privileged work through the preload bridge.
- Session Builder list items are draggable (HTML5 DnD). Preserve accessibility attributes and keep drag logic disabled while a structured session is active.

## Testing Guidelines
- No automated suite yet; after `npm start` manually cover scanning/rescan, connect/disconnect, pause/resume, session builder (including drag reorder), and telemetry.
- Future tests should live in `test/` or `src/__tests__/`, use the `*.spec.ts` suffix, and rely on the shared TypeScript config. Document manual checks in PRs.

## Commit & Pull Request Guidelines
- Follow the short, present-tense history (`add dashboard cards`, `fix scan retry`); keep subjects under ~60 characters.
- Squash work-in-progress commits; aim for one logical commit per PR.
- PRs must outline scope, touched files (e.g. `src/renderer/renderer.ts`), validation steps (`npm run lint`, BLE smoke test), and attach UI captures when visuals change. Reference issues (`Closes #12`) and highlight risk areas.

## Bluetooth & Environment Tips
- Confirm macOS Bluetooth permission after the first launch (Settings → Privacy & Security → Bluetooth).
- FTMS trainers allow a single connection; power-cycle the device if scans stall.
- Use Node.js ≥20.10 to keep `@abandonware/noble` stable on Apple Silicon.
