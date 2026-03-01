const OVERLAY_ID = "__veyes_status_overlay";
const DEFAULT_MAX_INTERACTIVE_ELEMENTS = 40;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case "STATUS_OVERLAY_UPDATE":
      updateOverlay(message.text || "Working...");
      sendResponse({ ok: true });
      return;
    case "DOM_SNAPSHOT_REQUEST":
      sendResponse({ snapshot: collectDomSnapshot(message.maxElements) });
      return;
    default:
      sendResponse({ ok: false, error: "Unknown message type." });
  }
});

function updateOverlay(text) {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = createOverlay();
    document.documentElement.appendChild(overlay);
  }
  overlay.textContent = text;
}

function createOverlay() {
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");

  overlay.style.position = "fixed";
  overlay.style.top = "16px";
  overlay.style.right = "16px";
  overlay.style.zIndex = "2147483647";
  overlay.style.maxWidth = "320px";
  overlay.style.padding = "10px 12px";
  overlay.style.borderRadius = "10px";
  overlay.style.background = "rgba(0, 0, 0, 0.82)";
  overlay.style.color = "#f8f9fa";
  overlay.style.fontSize = "13px";
  overlay.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  overlay.style.lineHeight = "1.45";
  overlay.style.boxShadow = "0 6px 18px rgba(0, 0, 0, 0.35)";
  overlay.style.pointerEvents = "none";

  return overlay;
}

function collectDomSnapshot(maxElements) {
  const effectiveMax =
    Number.isInteger(maxElements) && maxElements > 0
      ? Math.min(maxElements, 200)
      : DEFAULT_MAX_INTERACTIVE_ELEMENTS;

  const candidates = document.querySelectorAll(
    "a[href], button, input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])"
  );

  const elements = [];
  for (const element of candidates) {
    if (elements.length >= effectiveMax) {
      break;
    }

    if (!isVisible(element)) {
      continue;
    }

    elements.push({
      tag: element.tagName.toLowerCase(),
      text: normalizeText(readElementText(element)),
      ariaLabel: normalizeText(element.getAttribute("aria-label") || ""),
      placeholder: normalizeText(element.getAttribute("placeholder") || ""),
      selector: buildSelectorHint(element)
    });
  }

  return {
    title: document.title,
    url: window.location.href,
    maxElements: effectiveMax,
    elements
  };
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function readElementText(element) {
  if (element instanceof HTMLInputElement) {
    return element.value || "";
  }
  return element.innerText || element.textContent || "";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildSelectorHint(element) {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const name = element.getAttribute("name");
  if (name) {
    return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }

  const classes = Array.from(element.classList).slice(0, 2);
  if (classes.length > 0) {
    return `${element.tagName.toLowerCase()}.${classes.map((x) => CSS.escape(x)).join(".")}`;
  }

  return element.tagName.toLowerCase();
}
