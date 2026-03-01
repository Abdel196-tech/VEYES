# Extension <-> Pipecat WebSocket Contract (v1)

This is the authoritative wire contract between the Chrome extension and the Pipecat orchestrator.

## Transport Rules

- WebSocket URL: configurable in extension popup (default `ws://localhost:8765/ws`).
- Control frames: UTF-8 JSON text messages.
- Audio frames: binary frames (`ArrayBuffer`) sent immediately after each `audio.chunk` metadata control frame.
- Protocol version: `v = 1`.

## Envelope (JSON control frames)

```json
{
  "v": 1,
  "type": "string",
  "ts": "2026-03-01T12:34:56.000Z",
  "session_id": "uuid-optional",
  "request_id": "uuid-optional",
  "payload": {}
}
```

Field notes:
- `session_id`: required for session-scoped events (`audio.*`, `session.*`, `status.event`, `dom.snapshot.response`).
- `request_id`: required to pair request/response messages (`dom.snapshot.request` <-> `dom.snapshot.response`, `ping` <-> `pong`).

## Extension -> Pipecat

### `client.hello`

Sent once on socket open.

`payload`:
- `source` string
- `protocol_version` number
- `capabilities` object

### `session.started`

Sent when mic + socket pipeline is active.

`payload`:
- `source` string
- `transport.control_frames` = `json`
- `transport.audio_frames` = `binary_following_audio_chunk_meta`

### `audio.start`

Marks start of media stream.

`payload`:
- `mime_type` string (for example `audio/webm;codecs=opus`)
- `channels` number
- `timeslice_ms` number

### `audio.chunk`

Metadata for the next binary frame.

`payload`:
- `sequence` number (1-based, monotonic)
- `mime_type` string
- `duration_ms` number
- `byte_length` number

Immediately after this JSON frame, the extension sends one binary frame containing raw chunk bytes.

### `audio.stop`

Marks end of audio stream.

`payload`:
- `final_sequence` number

### `status.event`

Extension lifecycle status.

`payload`:
- `status` string
- `state` string or `null`

### `dom.snapshot.response`

Response to `dom.snapshot.request`.

`payload`:
- `page` object
- `error` string or `null`

`page` shape:
- `url` string or `null`
- `title` string or `null`
- `snapshot` object:
  - `title` string
  - `url` string
  - `maxElements` number
  - `elements` array of:
    - `tag`, `text`, `ariaLabel`, `placeholder`, `selector`

### `session.stopped`

Session end marker.

`payload`:
- `reason` string

### `pong`

Response to `ping`. Must echo `request_id`.

## Pipecat -> Extension

### `status.update`

Update on-screen aria-live overlay and popup status.

`payload`:
- `text` string

### `dom.snapshot.request`

Ask extension for current page snapshot.

`payload`:
- `max_elements` number (optional)

Must include `request_id`.

### `tts.play`

Play synthesized speech audio by URL.

`payload`:
- `audio_url` string

### `session.stop`

Instruct extension to stop current session.

`payload`:
- `reason` string (optional)

### `ping`

Health check. Extension responds with `pong` and same `request_id`.

## Ordering Guarantees

- WebSocket preserves frame order.
- For each audio chunk, Pipecat should consume exactly:
  1. one `audio.chunk` JSON frame
  2. one binary frame
- If one of the pair is missing, Pipecat should discard partial chunk and emit diagnostics.

## Error Handling Contract

- DOM snapshot failures are returned as `dom.snapshot.response` with `payload.error`:
  - `no_active_tab`
  - `snapshot_empty`
  - `snapshot_unavailable`
- Unknown control `type` values should be ignored, not fatal.
- Version mismatch (`v != 1`) should be treated as non-compatible and logged.
