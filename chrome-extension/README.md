# VEYES Chrome Extension (MV3)

This folder contains the first implementation step for the Chrome extension lane.

## Why this MV3 structure

- `service-worker.js`: control plane (session state, tab coordination, offscreen lifecycle).
- `offscreen.js`: media plane (microphone capture + WebSocket transport + TTS playback).
- `content-script.js`: page plane (DOM snapshot extraction + aria-live status overlay).
- `popup.*`: operator plane (start/stop and WebSocket endpoint config).

This split follows MV3 constraints:
- Service workers cannot directly access `getUserMedia`, so audio capture runs in an offscreen document.
- Content scripts are isolated from extension pages, so DOM reading and overlay updates run there.
- Popup is ephemeral UI only; session state lives in the background service worker.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `chrome-extension/`.
5. Open extension popup and set your orchestrator WebSocket URL (default `ws://localhost:8765/ws`).

## WebSocket Contract

Protocol and message types are documented in:

- `docs/ws-message-contract.md`
