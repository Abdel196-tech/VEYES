const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";
const DEFAULT_WS_URL = "ws://localhost:8765/ws";

const state = {
  running: false,
  wsUrl: DEFAULT_WS_URL,
  lastStatus: "Idle"
};

initializeState().catch((error) => {
  console.error("Failed to initialize extension state:", error);
});

chrome.runtime.onInstalled.addListener(() => {
  initializeState().catch((error) => console.error(error));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "POPUP_GET_STATE":
        sendResponse({ ok: true, state });
        return;
      case "POPUP_SET_WS_URL":
        await setWsUrl(message.wsUrl);
        sendResponse({ ok: true, state });
        return;
      case "SESSION_START":
        await startSession();
        sendResponse({ ok: true, state });
        return;
      case "SESSION_STOP":
        await stopSession();
        sendResponse({ ok: true, state });
        return;
      case "REQUEST_DOM_SNAPSHOT":
        await captureActiveTabContext({
          requestId: message.requestId ?? null,
          maxElements: message.maxElements ?? null
        });
        sendResponse({ ok: true });
        return;
      case "OFFSCREEN_STATUS":
        state.lastStatus = message.status ?? state.lastStatus;
        await broadcastState();
        await updateStatusOverlay(message.status);
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ ok: false, error: "Unknown message type." });
    }
  })().catch((error) => {
    console.error("Message handler error:", error);
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});

async function initializeState() {
  const data = await chrome.storage.local.get(["wsUrl"]);
  if (typeof data.wsUrl === "string" && data.wsUrl.length > 0) {
    state.wsUrl = data.wsUrl;
  }
  await broadcastState();
}

async function setWsUrl(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error("WebSocket URL cannot be empty.");
  }

  state.wsUrl = normalized;
  await chrome.storage.local.set({ wsUrl: normalized });
  await broadcastState();
}

async function startSession() {
  await ensureOffscreenDocument();
  state.lastStatus = "Starting voice session...";
  await broadcastState();

  const response = await chrome.runtime.sendMessage({ type: "OFFSCREEN_START", wsUrl: state.wsUrl });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to start offscreen session.");
  }

  state.running = true;
  await broadcastState();
}

async function stopSession() {
  state.running = false;
  state.lastStatus = "Stopped";
  await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
  await broadcastState();
}

async function captureActiveTabContext(options = {}) {
  const requestId = options.requestId ?? null;
  const maxElements = Number.isInteger(options.maxElements) ? options.maxElements : null;

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab?.id) {
    await chrome.runtime.sendMessage({
      type: "DOM_SNAPSHOT_RESULT",
      requestId,
      error: "no_active_tab"
    });
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "DOM_SNAPSHOT_REQUEST",
      requestId,
      maxElements
    });

    if (!response?.snapshot) {
      await chrome.runtime.sendMessage({
        type: "DOM_SNAPSHOT_RESULT",
        requestId,
        error: "snapshot_empty"
      });
      return;
    }

    await chrome.runtime.sendMessage({
      type: "DOM_SNAPSHOT_RESULT",
      requestId,
      payload: {
        url: activeTab.url ?? null,
        title: activeTab.title ?? null,
        snapshot: response.snapshot
      }
    });
  } catch (error) {
    console.warn("No content script response for DOM snapshot:", error);
    await chrome.runtime.sendMessage({
      type: "DOM_SNAPSHOT_RESULT",
      requestId,
      error: "snapshot_unavailable"
    });
  }
}

async function updateStatusOverlay(statusText) {
  if (!statusText) {
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab?.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(activeTab.id, {
      type: "STATUS_OVERLAY_UPDATE",
      text: statusText
    });
  } catch (error) {
    console.warn("Unable to update overlay on active tab:", error);
  }
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "Capture microphone audio and play speech feedback for accessible navigation."
  });
}

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) {
    return false;
  }

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  return contexts.length > 0;
}

async function broadcastState() {
  try {
    await chrome.runtime.sendMessage({ type: "STATE_UPDATE", state });
  } catch (_ignored) {
    // Ignore when no listener is active (for example popup closed).
  }
}
