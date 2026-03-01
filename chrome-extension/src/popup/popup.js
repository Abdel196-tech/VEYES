const wsUrlInput = document.getElementById("wsUrl");
const statusText = document.getElementById("statusText");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

startBtn.addEventListener("click", async () => {
  await saveWsUrl();
  await chrome.runtime.sendMessage({ type: "SESSION_START" });
});

stopBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "SESSION_STOP" });
});

wsUrlInput.addEventListener("change", async () => {
  await saveWsUrl();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "STATE_UPDATE") {
    return;
  }
  renderState(message.state);
});

refresh().catch((error) => {
  console.error("Popup initialization failed:", error);
});

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "POPUP_GET_STATE" });
  if (response?.ok) {
    renderState(response.state);
  }
}

async function saveWsUrl() {
  const wsUrl = wsUrlInput.value.trim();
  if (!wsUrl) {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "POPUP_SET_WS_URL",
    wsUrl
  });

  if (response?.ok) {
    renderState(response.state);
  }
}

function renderState(state) {
  if (!state) {
    return;
  }

  wsUrlInput.value = state.wsUrl || "";
  statusText.textContent = state.lastStatus || "Idle";
  startBtn.disabled = Boolean(state.running);
  stopBtn.disabled = !state.running;
}
