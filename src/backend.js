// The settings window and the quick panel run in two hosts: the Tauri desktop
// app and the Chrome extension. This picks the right one and gives both the
// same small API (`Backend`), so the rest of the UI doesn't care where it runs.
(function () {
  const g = globalThis;

  // ------------------------------------------------------------ desktop app

  function desktop() {
    const { invoke } = g.__TAURI__.core;
    const { listen } = g.__TAURI__.event;
    return {
      kind: "desktop",
      features: new Set([
        "globalSwitch",
        "monitors",
        "hotkey",
        "autostart",
        "hideFromCapture",
        "avoidTaskbar",
        "settingsOnTop",
      ]),
      async load() {
        const [settings, info] = await Promise.all([invoke("get_settings"), invoke("app_info")]);
        return { settings, info };
      },
      monitors: () => invoke("list_monitors"),
      save: (settings) => invoke("update_settings", { settings }),
      setEnabled: (enabled) => invoke("set_enabled", { enabled }),
      setHotkey: (hotkey) => invoke("set_hotkey", { hotkey }),
      setAutostart: (enabled) => invoke("set_autostart", { enabled }),
      onChange: (cb) => listen("settings-changed", (e) => cb(e.payload)),
      openSettings: () => invoke("open_settings"),
      closePanel: () => invoke("hide_flyout"),
      onPanelShown: (cb) => listen("flyout-shown", () => cb()),
      // The tray panel is a fixed-size window: it follows the content's height.
      resizePanel: (height) => invoke("resize_flyout", { height }),
    };
  }

  // ------------------------------------------------------- Chrome extension

  const DEFAULTS = {
    // Unused by the extension: the light is switched on per tab (see
    // background.js), and comes on by itself in a tab that uses the camera.
    enabled: false,
    language: "auto",
    shape: "frame",
    colorMode: "solid",
    color: "#ffefe1", // 5600 K
    kelvin: 5600,
    gradient: ["#ffa757", "#fffefa"],
    angle: 0,
    sides: [
      { on: true, color: "#ffefe1" },
      { on: true, color: "#fffefa" },
      { on: true, color: "#ffefe1" },
      { on: true, color: "#ffc18d" },
    ],
    effect: "none",
    speed: 4,
    opacity: 100,
    intensity: 100,
    // A browser viewport is smaller than a screen: a slimmer band by default.
    thickness: 40,
    softness: 40,
    radius: 16,
    autoCamera: true,
    hideWhileSharing: true,
    // Scale the page down so its content fits inside the band.
    shrinkPage: false,
  };

  const pick = (value, allowed) => (allowed.includes(value) ? value : allowed[0]);
  const hex = (value, fallback) =>
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  const int = (value, min, max, fallback) =>
    Number.isFinite(+value) && value !== null && value !== "" ? Math.min(max, Math.max(min, Math.round(+value))) : fallback;

  /** Same rules as `Settings::sanitize` in the desktop app. */
  function sanitize(raw) {
    const s = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
    return {
      enabled: Boolean(s.enabled),
      language: pick(s.language, ["auto", "pt", "en"]),
      shape: pick(s.shape, ["frame", "oval", "circle", "bars"]),
      colorMode: pick(s.colorMode, ["solid", "linear", "conic", "sides"]),
      color: hex(s.color, DEFAULTS.color),
      kelvin: s.kelvin == null ? null : int(s.kelvin, 1500, 10000, null),
      gradient:
        Array.isArray(s.gradient) && s.gradient.length >= 2
          ? s.gradient.slice(0, 5).map((c) => hex(c, DEFAULTS.color))
          : [...DEFAULTS.gradient],
      angle: ((int(s.angle, -36000, 36000, 0) % 360) + 360) % 360,
      sides:
        Array.isArray(s.sides) && s.sides.length === 4
          ? s.sides.map((x, i) => ({ on: x?.on !== false, color: hex(x?.color, DEFAULTS.sides[i].color) }))
          : DEFAULTS.sides.map((x) => ({ ...x })),
      effect: pick(s.effect, ["none", "rotate", "pulse", "hue"]),
      speed: int(s.speed, 1, 10, DEFAULTS.speed),
      opacity: int(s.opacity, 5, 100, DEFAULTS.opacity),
      intensity: int(s.intensity, 10, 100, DEFAULTS.intensity),
      thickness: int(s.thickness, 4, 1000, DEFAULTS.thickness),
      softness: int(s.softness, 0, 200, DEFAULTS.softness),
      radius: int(s.radius, 0, 300, DEFAULTS.radius),
      autoCamera: Boolean(s.autoCamera),
      hideWhileSharing: Boolean(s.hideWhileSharing),
      shrinkPage: Boolean(s.shrinkPage),
    };
  }

  // chrome.storage.local rather than .sync: dragging a slider writes many
  // times per second, far beyond sync's per-minute write quota.
  const Store = {
    async get() {
      const { settings } = await chrome.storage.local.get("settings");
      return sanitize(settings);
    },
    async set(settings) {
      const clean = sanitize(settings);
      await chrome.storage.local.set({ settings: clean });
      return clean;
    },
    onChange(cb) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.settings) cb(sanitize(changes.settings.newValue));
      });
    },
  };

  /**
   * The light is switched on per tab. In the toolbar popup, `enabled` stands
   * for the tab the popup belongs to; `tab` says whether that page can show
   * the light at all (Chrome's own pages can't run extensions) and why it's lit.
   */
  async function activeTab() {
    if (!chrome.tabs) return null; // content scripts and the service worker
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  }

  async function tabState(tab) {
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: "state" });
    } catch {
      return null; // no content script there
    }
  }

  function extension() {
    let tab = { available: false, lit: false, camera: false, manual: null };
    return {
      kind: "extension",
      features: new Set(["hideWhileSharing", "browserShortcut", "shrinkPage"]),
      async load() {
        const ui = chrome.i18n.getUILanguage().toLowerCase();
        const current = await activeTab();
        const state = current && (await tabState(current));
        tab = state ? { available: true, ...state } : { available: false, lit: false, camera: false, manual: null };
        return {
          settings: { ...(await Store.get()), enabled: tab.lit },
          info: { version: chrome.runtime.getManifest().version, systemLanguage: ui.startsWith("pt") ? "pt" : "en", tab },
        };
      },
      monitors: async () => [],
      save: (settings) => Store.set(settings),
      /** Switches the light in the popup's tab only. */
      async setEnabled(enabled) {
        const current = await activeTab();
        const state = current && (await chrome.runtime.sendMessage({ type: "set-tab", tabId: current.id, on: enabled }));
        if (state) tab = { available: true, ...state };
        return { ...(await Store.get()), enabled: tab.lit };
      },
      tab: () => tab,
      onChange: (cb) => Store.onChange((s) => cb({ ...s, enabled: tab.lit })),
      openSettings: () => chrome.runtime.openOptionsPage(),
      closePanel: () => g.close(),
      // The popup is a fresh page every time it opens.
      onPanelShown: (cb) => cb(),
      resizePanel: () => {}, // the popup sizes itself to its content
      async shortcut() {
        const commands = await chrome.commands.getAll();
        return commands.find((c) => c.name === "toggle")?.shortcut ?? "";
      },
      editShortcut: () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
    };
  }

  g.RinglightStore = Store;
  g.Backend = g.__TAURI__ ? desktop() : g.chrome?.storage ? extension() : null;
})();
