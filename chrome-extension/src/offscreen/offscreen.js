import {
  CLIENT_NAME,
  WS_MESSAGE_TYPE,
  createEnvelope,
  normalizeRequestId,
  parseJsonEnvelope
} from "../shared/ws-contract.js";

const AUDIO_TIMESLICE_MS = 250;

let mediaStream = null;
let mediaRecorder = null;
let ws = null;
let sessionId = null;
let audioChunkSeq = 0;
let audioMimeType = "audio/webm";
let suppressDisconnectStatus = false;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "OFFSCREEN_START":
        await startSession(message.wsUrl);
        sendResponse({ ok: true });
        return;
      case "OFFSCREEN_STOP":
        await stopSession();
        sendResponse({ ok: true });
        return;
      case "DOM_SNAPSHOT_RESULT":
        await forwardDomSnapshot(message);
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ ok: false, error: "Unknown message type." });
    }
  })().catch((error) => {
    console.error("Offscreen message error:", error);
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});

async function startSession(wsUrl) {
  await stopSession({ sendStopEvents: false, statusText: null });
  sessionId = crypto.randomUUID();
  audioChunkSeq = 0;
  await connectWebSocket(wsUrl);
  await startMicCapture();

  sendWs(
    createEnvelope(
      WS_MESSAGE_TYPE.SESSION_STARTED,
      {
        source: CLIENT_NAME,
        transport: {
          control_frames: "json",
          audio_frames: "binary_following_audio_chunk_meta"
        }
      },
      { sessionId }
    )
  );

  await sendStatus("Listening", { emitWs: true, state: "listening" });
}

async function stopSession(options = {}) {
  const sendStopEvents = options.sendStopEvents ?? true;
  const statusText = options.statusText ?? "Stopped";

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  mediaRecorder = null;

  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
  }
  mediaStream = null;

  if (sendStopEvents && ws?.readyState === WebSocket.OPEN && sessionId) {
    sendWs(
      createEnvelope(
        WS_MESSAGE_TYPE.AUDIO_STOP,
        {
          final_sequence: audioChunkSeq
        },
        { sessionId }
      )
    );
    sendWs(
      createEnvelope(
        WS_MESSAGE_TYPE.SESSION_STOPPED,
        {
          reason: "user_or_extension_stop"
        },
        { sessionId }
      )
    );
  }

  if (ws?.readyState === WebSocket.OPEN) {
    suppressDisconnectStatus = true;
    ws.close();
  }
  ws = null;
  sessionId = null;
  audioChunkSeq = 0;

  if (statusText) {
    await sendStatus(statusText, { emitWs: false });
  }
}

async function connectWebSocket(wsUrl) {
  const target = String(wsUrl ?? "").trim();
  if (!target) {
    throw new Error("WebSocket URL is required.");
  }

  await new Promise((resolve, reject) => {
    ws = new WebSocket(target);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      sendWs(
        createEnvelope(
          WS_MESSAGE_TYPE.CLIENT_HELLO,
          {
            source: CLIENT_NAME,
            protocol_version: 1,
            capabilities: {
              audio_input: true,
              dom_snapshot: true,
              status_overlay: true,
              tts_audio_url: true
            }
          },
          { sessionId }
        )
      );
      resolve();
    };

    ws.onclose = async () => {
      ws = null;
      if (suppressDisconnectStatus) {
        suppressDisconnectStatus = false;
        return;
      }
      await sendStatus("Disconnected", { emitWs: false });
    };

    ws.onerror = () => {
      reject(new Error("Unable to connect to orchestrator WebSocket."));
    };

    ws.onmessage = (event) => {
      handleServerMessage(event.data).catch((error) => {
        console.error("Server message handling error:", error);
      });
    };
  });
}

async function startMicCapture() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioMimeType = selectAudioMimeType();

  mediaRecorder = new MediaRecorder(mediaStream, {
    mimeType: audioMimeType
  });

  mediaRecorder.addEventListener("dataavailable", async (event) => {
    if (!event.data || event.data.size === 0 || ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const audioBuffer = await event.data.arrayBuffer();
    audioChunkSeq += 1;

    sendWs(
      createEnvelope(
        WS_MESSAGE_TYPE.AUDIO_CHUNK,
        {
          sequence: audioChunkSeq,
          mime_type: audioMimeType,
          duration_ms: AUDIO_TIMESLICE_MS,
          byte_length: audioBuffer.byteLength
        },
        { sessionId }
      )
    );
    ws.send(audioBuffer);
  });

  mediaRecorder.start(AUDIO_TIMESLICE_MS);

  sendWs(
    createEnvelope(
      WS_MESSAGE_TYPE.AUDIO_START,
      {
        mime_type: audioMimeType,
        channels: 1,
        timeslice_ms: AUDIO_TIMESLICE_MS
      },
      { sessionId }
    )
  );
}

function selectAudioMimeType() {
  const opusMime = "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported(opusMime)) {
    return opusMime;
  }
  return "audio/webm";
}

async function handleServerMessage(data) {
  const message = parseJsonEnvelope(data);
  if (!message) {
    return;
  }

  if (typeof message.v === "number" && message.v !== 1) {
    await sendStatus("Protocol version mismatch", { emitWs: false });
    return;
  }

  switch (message.type) {
    case WS_MESSAGE_TYPE.STATUS_UPDATE:
      await sendStatus(message.payload?.text ?? "Working...", { emitWs: false });
      return;
    case WS_MESSAGE_TYPE.DOM_SNAPSHOT_REQUEST:
      await chrome.runtime.sendMessage({
        type: "REQUEST_DOM_SNAPSHOT",
        requestId: normalizeRequestId(message.request_id),
        maxElements: message.payload?.max_elements
      });
      return;
    case WS_MESSAGE_TYPE.TTS_PLAY:
      await playAudioFromUrl(message.payload?.audio_url);
      return;
    case WS_MESSAGE_TYPE.SESSION_STOP:
      await stopSession({ sendStopEvents: false, statusText: "Stopped by orchestrator" });
      return;
    case WS_MESSAGE_TYPE.PING:
      sendWs(
        createEnvelope(
          WS_MESSAGE_TYPE.PONG,
          {
            ping_ts: message.ts ?? null
          },
          {
            sessionId: sessionId ?? undefined,
            requestId: message.request_id
          }
        )
      );
      return;
    default:
      return;
  }
}

async function playAudioFromUrl(url) {
  if (!url) {
    return;
  }
  const audio = new Audio(url);
  await audio.play();
}

async function sendStatus(status, options = {}) {
  const emitWs = options.emitWs ?? false;
  const state = options.state ?? null;

  await chrome.runtime.sendMessage({
    type: "OFFSCREEN_STATUS",
    status
  });

  if (emitWs && ws?.readyState === WebSocket.OPEN && sessionId) {
    sendWs(
      createEnvelope(
        WS_MESSAGE_TYPE.STATUS_EVENT,
        {
          status,
          state
        },
        { sessionId }
      )
    );
  }
}

async function forwardDomSnapshot(message) {
  if (ws?.readyState !== WebSocket.OPEN) {
    return;
  }

  const payload = message.payload ?? {};
  const error = message.error ?? null;

  sendWs(
    createEnvelope(
      WS_MESSAGE_TYPE.DOM_SNAPSHOT_RESPONSE,
      {
        page: payload,
        error
      },
      {
        sessionId: sessionId ?? undefined,
        requestId: message.requestId ?? undefined
      }
    )
  );
}

function sendWs(envelope) {
  if (ws?.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(envelope));
}
