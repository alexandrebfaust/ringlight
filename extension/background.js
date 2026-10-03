// Service worker: the per-tab switch, the on/off shortcut and the toolbar
// icon, drawn with the current light colors in lit tabs (gray elsewhere).
importScripts("ui/backend.js");

const ICON_SIZES = [16, 32];

const rgb = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

/** Light color at position `t` around the ring (0 = top, clockwise), or null where it's off. */
function colorAt(s, t) {
  if (s.colorMode === "linear" || s.colorMode === "conic") {
    // The icon wraps the stops around the ring; close enough at this size.
    const n = s.gradient.length;
    const pos = t * n;
    const i = Math.floor(pos) % n;
    return mix(rgb(s.gradient[i]), rgb(s.gradient[(i + 1) % n]), pos - Math.floor(pos));
  }
  if (s.colorMode === "sides") {
    const side = s.sides[Math.floor((t + 0.125) * 4) % 4];
    return side.on ? rgb(side.color) : null;
  }
  return rgb(s.color);
}

/** Same look as the desktop tray icon: thick and colored when lit, thin and gray when off. */
function ringIcon(s, lit, size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const c = size / 2;
  const outer = c - size / 32;
  const inner = lit ? c * 0.5 : c * 0.68;
  const segments = 64;
  for (let i = 0; i < segments; i++) {
    const color = lit ? colorAt(s, (i + 0.5) / segments) : [140, 140, 140];
    if (!color) continue;
    const a0 = (i / segments) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1.03) / segments) * 2 * Math.PI - Math.PI / 2; // overlap hides seams
    ctx.beginPath();
    ctx.arc(c, c, outer, a0, a1);
    ctx.arc(c, c, inner, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = `rgb(${color.join(",")})`;
    ctx.fill();
  }
  if (lit) {
    // Faint outline so white light stays visible on a light toolbar.
    ctx.strokeStyle = "rgba(40, 40, 40, 0.5)";
    ctx.lineWidth = Math.max(1, size / 24);
    for (const r of [outer, inner]) {
      ctx.beginPath();
      ctx.arc(c, c, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
  return ctx.getImageData(0, 0, size, size);
}

const iconFor = (s, lit) => Object.fromEntries(ICON_SIZES.map((n) => [n, ringIcon(s, lit, n)]));

/** The default icon is the "off" one; lit tabs get a colored icon of their own. */
async function refreshIcon(settings) {
  const s = settings ?? (await RinglightStore.get());
  await chrome.action.setIcon({ imageData: iconFor(s, false) });
}

// ------------------------------------------------------------ per-tab switch

// tabId -> true (on) or false (off, even when the tab uses the camera). Tabs
// without an entry follow the camera. Kept in session storage, which outlives
// the service worker's naps but not the browser.
async function tabStates() {
  const { tabs = {} } = await chrome.storage.session.get("tabs");
  return tabs;
}

/** Switches one tab and returns what its page reports back. */
async function switchTab(tabId, on) {
  const tabs = await tabStates();
  tabs[tabId] = on;
  await chrome.storage.session.set({ tabs });
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "tab-state", manual: on });
  } catch {
    return null; // a page the extension can't run in
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabs = await tabStates();
  delete tabs[tabId];
  await chrome.storage.session.set({ tabs });
});

chrome.runtime.onInstalled.addListener(async () => {
  // Write the defaults once so every page reads the same values.
  await RinglightStore.set(await RinglightStore.get());
  await refreshIcon();
});
chrome.runtime.onStartup.addListener(() => refreshIcon());
RinglightStore.onChange((s) => refreshIcon(s));

// The shortcut switches the tab you're looking at.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  const state = await chrome.tabs.sendMessage(tab.id, { type: "state" }).catch(() => null);
  if (state) await switchTab(tab.id, !(state.lit || state.manual === true));
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tabId = sender.tab?.id;
  switch (message?.type) {
    // A page starting up asks how its tab was switched.
    case "hello":
      tabStates().then((tabs) => reply({ manual: tabs[tabId] ?? null }));
      return true;
    // The toolbar popup switches its tab.
    case "set-tab":
      switchTab(message.tabId, message.on).then(reply);
      return true;
    // A page lit or went dark: color its tab's icon.
    case "lit":
      if (tabId != null) {
        RinglightStore.get().then((s) => chrome.action.setIcon({ tabId, imageData: iconFor(s, message.lit) }));
      }
      return false;
  }
  return false;
});
