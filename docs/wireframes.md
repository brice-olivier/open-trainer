# Wireframe Drafts

These sketches outline the four primary screens of the desktop app. They assume a fixed Electron window with a persistent left navigation rail and top status bar. Boxes are not to scale; labels describe the role of each region.

## Global Frame

```
+------------------------------------------------------------------------------+
| Top Bar: App title • Ride status badge • Quick actions (Settings, Logs)      |
+-------+----------------------------------------------------------------------+
| Nav   | Active view header (title, context actions)                          |
| Rail  +--------------------------------------------------------------------+-+
|       |                                                                      |
| Icons |  Main content area (screen-specific layouts below)                   |
|       |                                                                      |
+-------+----------------------------------------------------------------------+
| Status footer: connection summary • telemetry heartbeat • export queue       |
+------------------------------------------------------------------------------+
```

Left rail icons: dashboard (Device Hub), workouts, training, history. Footer shows currently paired trainer/power/HRM with indicator lights.

## Device Hub

```
+------------------------------------------------------------------------------+
| Header: "Device Hub" • Scan button • Last scan timestamp                     |
+------------------------------------------------------------------------------+
| Device cards grid (responsive two-column)                                    |
| +-----------------------------------+  +-----------------------------------+ |
| | Trainer Name (Paired)             |  | HR Sensor (Available)            | |
| | Signal strength • Battery level   |  | Signal bars • Battery            | |
| | Metrics chips (Power/Cadence)     |  | Metrics chips (Heart Rate)       | |
| | [Connect/Disconnect] [Details >]  |  | [Pair]                           | |
| +-----------------------------------+  +-----------------------------------+ |
| ...                                                                        ...|
+------------------------------------------------------------------------------+
| Detail Drawer (slides up from bottom when opened)                            |
| Device summary • rename field • preferred power source dropdown              |
| Tabs: Overview | Calibration | Sensors                                       |
| - Overview: firmware, serial, last connected                                 |
| - Calibration: Instructions, start spin-down button, live progress           |
| - Sensors: toggles for metrics, raw data preview                             |
+------------------------------------------------------------------------------+
| Live Diagnostics Strip                                                       |
| Power XX W • Cadence XX rpm • HR XX bpm • Connection health bar • Reconnect  |
+------------------------------------------------------------------------------+
```

## Workout Studio

```
+------------------------------------------------------------------------------+
| Header: "Workout Studio" • [New Workout] button                              |
+-------------------------+----------------------------------------------------+
| Workout List            | Selected workout summary                           |
| +---------------------+ | +-----------------------------------------------+ |
| | Tempo Builder        | | Label, total duration, estimated TSS/IF        | |
| | 45 min               | | Block timeline mini-map                        | |
| +---------------------+ | |                                               | |
| | Sweet Spot #3        | |                                               | |
| | 60 min               | |                                               | |
| +---------------------+ | +-----------------------------------------------+ |
| ...                     |                                                  |
+-------------------------+----------------------------------------------------+
```

**Create/Edit Modal**

```
+--------------------------------------------------------------------------+
| Title field • Duration auto-sum • Save / Cancel                          |
+----------------------------------+---------------------------------------+
| Block timeline (vertical list)   | Block details inspector               |
| [1] Warm-up 10' @ 150 W          | Fields: type (target / free ride)     |
| [2] Interval 5' @ 280 W          | Target watts slider/input             |
| [3] Recovery 3' @ 160 W          | Duration picker (min/sec)             |
| ...                              | Notes (optional)                      |
| + Add block                      | Quick presets buttons                 |
+----------------------------------+---------------------------------------+
| Validation banner (conflicts, gaps) • Summary chips (total time, avg W)  |
+--------------------------------------------------------------------------+
```

## Training Arena

```
+------------------------------------------------------------------------------+
| Header: "Training Arena" • Mode toggle [Free Ride | Guided] • Ride timer     |
+------------------------------------------------------------------------------+
| Guided workout view                                                          |
+---------------------------+-----------------------------+--------------------+
| Workout progression       | Live gauges                 | Device telemetry   |
| (vertical steps with      | Large power dial (current   | ERG toggle         |
| current block highlighted)| vs target)                  | Trainer mode       |
|                           | Cadence bar, HR bar         | Resistance slider  |
|                           | Compliance indicator        | Connection status  |
+---------------------------+-----------------------------+--------------------+
| Control bar: Start/Pause/Resume • End Ride • Skip block • +/- Resistance •   |
| Extend block • Lap • Notes                                                   |
+------------------------------------------------------------------------------+
| Metrics panel (bottom)                                                        |
| Avg Power • NP • kJ • Avg HR • HR zones graph • Cadence trend sparkline      |
+------------------------------------------------------------------------------+
| End-of-ride dialog (overlay when ride stops): summary stats, notes box, save |
+------------------------------------------------------------------------------+
```

Free Ride mode reuses the layout but replaces the progression column with customizable resistance targets and optional quick set tiles (e.g., 150 W, 200 W).

## History & Export

```
+------------------------------------------------------------------------------+
| Header: "Ride History" • [Export selected] button                            |
+-------------------------+----------------------------------------------------+
| Session list (chronological) | Selected ride details                         |
| +-------------------------+ | +-------------------------------------------+ |
| | 2024-04-08 Tempo Build  | | Header: ride title, date, duration, avg W  | |
| | 45 min • 210 W avg      | | Charts tabs: Power | Cadence | Heart Rate  | |
| +-------------------------+ | | Interval compliance table                 | |
| | 2024-04-05 Free Ride    | | Notes panel • Export status tag            | |
| | 30 min • 180 W avg      | +-------------------------------------------+ |
| +-------------------------+                                                |
| ...                                                                         |
+-------------------------+----------------------------------------------------+
| Export Queue (bottom drawer)                                                 |
| Listed .fit jobs with status (Queued / Processing / Done) and download icons |
+------------------------------------------------------------------------------+
```

Selecting a session surfaces per-block stats and compliance markers. Export drawer persists across screens so long-running `.fit` generation remains visible.

