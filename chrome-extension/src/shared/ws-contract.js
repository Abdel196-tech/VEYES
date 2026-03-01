export const WS_PROTOCOL_VERSION = 1;
export const CLIENT_NAME = "veyes_chrome_extension";

export const WS_MESSAGE_TYPE = Object.freeze({
  CLIENT_HELLO: "client.hello",
  SESSION_STARTED: "session.started",
  SESSION_STOPPED: "session.stopped",
  AUDIO_START: "audio.start",
  AUDIO_CHUNK: "audio.chunk",
  AUDIO_STOP: "audio.stop",
  STATUS_EVENT: "status.event",
  STATUS_UPDATE: "status.update",
  DOM_SNAPSHOT_REQUEST: "dom.snapshot.request",
  DOM_SNAPSHOT_RESPONSE: "dom.snapshot.response",
  TTS_PLAY: "tts.play",
  SESSION_STOP: "session.stop",
  PING: "ping",
  PONG: "pong",
  ERROR_EVENT: "error.event"
});

export function createEnvelope(type, payload = {}, options = {}) {
  const envelope = {
    v: WS_PROTOCOL_VERSION,
    type,
    ts: new Date().toISOString(),
    payload
  };

  if (options.sessionId) {
    envelope.session_id = options.sessionId;
  }

  if (options.requestId) {
    envelope.request_id = options.requestId;
  }

  return envelope;
}

export function parseJsonEnvelope(raw) {
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.type !== "string") {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
}

export function normalizeRequestId(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return crypto.randomUUID();
}
