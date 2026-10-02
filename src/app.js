const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (id) => document.getElementById(id);

const GRADIENT_PRESETS = [
  ["g_warmcool", ["#ffa757", "#fffefa"]],
  ["g_sunset", ["#ff5e62", "#ff9966", "#ffd3a5"]],
  ["g_ocean", ["#1c92d2", "#6dd5ed", "#f2fcfe"]],
  ["g_neon", ["#ff00cc", "#7a00ff", "#00e5ff"]],
  ["g_rainbow", ["#ff0000", "#ffee00", "#00ff44", "#00aaff", "#aa00ff"]],
];
// CSS gradient angles: 0° goes from bottom to top, clockwise.
const ARROW_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const ARROW_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path d="M8 13.5V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SIDE_KEYS = ["side_top", "side_right", "side_bottom", "side_left"];
const SLIDERS = ["angle", "speed", "opacity", "intensity", "thickness", "softness", "radius"];
const MAX_STOPS = 5;
const LAMP_SIZE = 48;

let s = null; // current settings
let info = null; // { version, systemLanguage }
let lang = "en";
let monitors = [];
const lampPainters = [new RingPaint($("lampGlow")), new RingPaint($("lampRing"))];

const t = (key, vars) => translate(lang, key, vars);

const isGradient = () => s.colorMode === "linear" || s.colorMode === "conic";
const sameColors = (a, b) => a.length === b.length && a.every((c, i) => c.toLowerCase() === b[i].toLowerCase());

const push = createPusher(() => s, (e) => toast(e));

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = String(message);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

// -------------------------------------------------------------- rendering

function renderPower() {
  $("enabled").checked = s.enabled;
  $("status").textContent = t(s.enabled ? "status_on" : "status_off");
  renderLamp();
}

function renderLamp() {
  const lamp = $("lamp");
  lamp.classList.toggle("off", !s.enabled);
  lamp.style.opacity = s.enabled ? String(0.25 + (0.75 * s.opacity) / 100) : "1";
  for (const p of lampPainters) p.update(s, LAMP_SIZE, LAMP_SIZE, s.enabled);
}

function renderSeg(id, value) {
  for (const btn of $(id).children) btn.setAttribute("aria-checked", String(btn.dataset.value === value));
}

function renderMode() {
  renderSeg("colorMode", s.colorMode);
  for (const el of document.querySelectorAll("[data-panel]")) {
    el.hidden = !el.dataset.panel.split(" ").includes(s.colorMode);
  }
  $("angleLabel").textContent = t(s.colorMode === "linear" ? "angle" : "start_angle");
}

function renderSolid() {
  const kelvin = $("kelvin");
  if (s.kelvin != null) kelvin.value = s.kelvin;
  $("kelvinOut").textContent = s.kelvin != null ? `${s.kelvin} K` : t("custom");
  kelvin.style.setProperty("--thumb", s.kelvin != null ? s.color : kelvinToHex(+kelvin.value));
  $("color").value = s.color;
  $("colorHex").textContent = s.color;
  for (const btn of $("kelvinPresets").children) {
    btn.setAttribute("aria-pressed", String(+btn.dataset.k === s.kelvin));
  }
}

function renderGradientPresets() {
  GRADIENT_PRESETS.forEach(([, colors], i) => {
    $("gradientPresets").children[i].setAttribute("aria-pressed", String(sameColors(colors, s.gradient)));
  });
}

function renderStops() {
  const box = $("stops");
  box.replaceChildren();
  s.gradient.forEach((color, i) => {
    const stop = document.createElement("div");
    stop.className = "stop";
    const input = document.createElement("input");
    input.type = "color";
    input.value = color;
    input.dataset.index = i;
    stop.append(input);
    if (s.gradient.length > 2) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.dataset.remove = i;
      remove.title = t("remove_color");
      remove.setAttribute("aria-label", t("remove_color"));
      stop.append(remove);
    }
    box.append(stop);
  });
  if (s.gradient.length < MAX_STOPS) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-stop";
    add.textContent = "+";
    add.dataset.add = "";
    add.title = t("add_color");
    add.setAttribute("aria-label", t("add_color"));
    box.append(add);
  }
}

function renderArrows() {
  for (const btn of $("arrows").children) {
    btn.setAttribute("aria-pressed", String(+btn.dataset.angle === s.angle));
  }
}

function renderGradient() {
  renderGradientPresets();
  renderStops();
  renderArrows();
  renderSlider("angle");
}

function renderSides() {
  s.sides.forEach((side, i) => {
    const row = $("sides").children[i];
    row.classList.toggle("off", !side.on);
    row.querySelector('input[type="checkbox"]').checked = side.on;
    row.querySelector('input[type="color"]').value = side.color;
  });
}

function renderEffect() {
  renderSeg("effect", s.effect);
  $("effect").querySelector('[data-value="rotate"]').disabled = !isGradient() && s.effect !== "rotate";
  $("speedRow").hidden = s.effect === "none";
  const hint = $("effectHint");
  if (s.effect === "rotate" && !isGradient()) {
    hint.textContent = t("hint_rotate");
    hint.hidden = false;
  } else if (s.effect === "hue") {
    hint.textContent = t("hint_hue");
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}

function renderSlider(id) {
  const input = $(id);
  input.value = s[id];
  const pct = ((s[id] - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty("--p", `${pct}%`);
  document.querySelector(`output[data-for="${id}"]`).textContent = s[id] + input.dataset.unit;
}

function hotkeyLabel(hotkey) {
  return hotkey
    .split("+")
    .map((part) => part.replace(/^Key/, "").replace(/^Digit/, ""))
    .join(" + ");
}

function renderHotkey() {
  const btn = $("hotkey");
  btn.classList.remove("recording");
  btn.classList.toggle("empty", !s.hotkey);
  btn.textContent = s.hotkey ? hotkeyLabel(s.hotkey) : t("hotkey_none");
  $("hotkeyClear").hidden = !s.hotkey;
}

function renderMonitors() {
  const select = $("monitor");
  const label = (m) =>
    `${t("display_n", { n: m.number })} · ${m.width}×${m.height}${m.primary ? ` (${t("primary")})` : ""}`;
  select.replaceChildren(
    new Option(t("monitor_primary"), "primary"),
    new Option(t("monitor_all"), "all"),
    ...monitors.map((m) => new Option(label(m), m.id)),
  );
  select.value = s.monitor;
  if (select.value !== s.monitor) select.value = "primary";
}

function renderLanguages() {
  const select = $("language");
  select.replaceChildren(
    new Option(t("lang_auto", { lang: LANGUAGE_NAMES[info.systemLanguage] }), "auto"),
    new Option(LANGUAGE_NAMES.pt, "pt"),
    new Option(LANGUAGE_NAMES.en, "en"),
  );
  select.value = s.language;
}

function renderAll() {
  renderPower();
  renderMode();
  renderSolid();
  renderGradient();
  renderSides();
  renderEffect();
  SLIDERS.forEach(renderSlider);
  renderMonitors();
  renderLanguages();
  $("hideFromCapture").checked = s.hideFromCapture;
  $("autoCamera").checked = s.autoCamera;
  $("avoidTaskbar").checked = s.avoidTaskbar;
  $("settingsOnTop").checked = s.settingsOnTop;
  $("autostart").checked = s.autostart;
  renderHotkey();
}

/** Translates the static text, then redraws everything that holds text. */
function applyLanguage() {
  lang = resolveLanguage(s, info);
  translateDom(lang);
  renderAll();
}

// ------------------------------------------------------------ static markup

function buildStatic() {
  const kelvins = $("kelvinPresets");
  for (const [k, key] of KELVIN_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.k = k;
    btn.style.setProperty("--c", kelvinToHex(k));
    btn.innerHTML = `<i></i><span data-i18n="${key}"></span><small>${k} K</small>`;
    kelvins.append(btn);
  }

  $("kelvin").style.setProperty("--temp-gradient", temperatureGradient());

  const gradients = $("gradientPresets");
  GRADIENT_PRESETS.forEach(([key, colors], i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.preset = i;
    btn.style.setProperty("--g", `linear-gradient(90deg, ${colors.join(", ")})`);
    btn.innerHTML = `<i></i><span data-i18n="${key}"></span>`;
    gradients.append(btn);
  });

  const arrows = $("arrows");
  for (const angle of ARROW_ANGLES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.angle = angle;
    btn.title = `${angle}°`;
    btn.innerHTML = ARROW_SVG;
    btn.firstChild.style.transform = `rotate(${angle}deg)`;
    arrows.append(btn);
  }

  const sides = $("sides");
  SIDE_KEYS.forEach((key, i) => {
    const row = document.createElement("div");
    row.className = "side";
    row.dataset.index = i;
    row.innerHTML =
      `<label class="switch"><input type="checkbox" id="side${i}" /><span></span></label>` +
      `<label for="side${i}" data-i18n="${key}"></label>` +
      `<input type="color" />`;
    sides.append(row);
  });
}

// ----------------------------------------------------------------- hotkey

let recording = false;

function startRecording() {
  recording = true;
  const btn = $("hotkey");
  btn.classList.add("recording");
  btn.classList.remove("empty");
  btn.textContent = t("hotkey_press");
}

function stopRecording() {
  recording = false;
  renderHotkey();
}

async function saveHotkey(hotkey) {
  try {
    s = await invoke("set_hotkey", { hotkey });
  } catch (e) {
    toast(e);
  }
  stopRecording();
}

window.addEventListener(
  "keydown",
  (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return stopRecording();
    if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(e.key)) return;

    const mods = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.metaKey) mods.push("Super");
    if (!mods.length && !/^F\d+$/.test(e.code)) {
      $("hotkey").textContent = t("hotkey_need_mod");
      return;
    }
    saveHotkey([...mods, e.code].join("+"));
  },
  true,
);

// ----------------------------------------------------------------- events

function setKelvin(k) {
  s.kelvin = k;
  s.color = kelvinToHex(k);
  renderSolid();
  renderLamp();
  push();
}

function onSeg(id, apply) {
  $(id).addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn && !btn.disabled) apply(btn.dataset.value);
  });
}

function bind() {
  $("enabled").addEventListener("change", async (e) => {
    s = await invoke("set_enabled", { enabled: e.target.checked });
    renderPower();
  });

  onSeg("colorMode", (mode) => {
    s.colorMode = mode;
    renderMode();
    renderEffect();
    renderLamp();
    push();
  });

  onSeg("effect", (effect) => {
    s.effect = effect;
    renderEffect();
    renderLamp();
    push();
  });

  // Solid
  $("kelvinPresets").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) setKelvin(+btn.dataset.k);
  });
  $("kelvin").addEventListener("input", (e) => setKelvin(+e.target.value));
  $("color").addEventListener("input", (e) => {
    s.color = e.target.value;
    s.kelvin = null;
    renderSolid();
    renderLamp();
    push();
  });

  // Gradients
  $("gradientPresets").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    s.gradient = [...GRADIENT_PRESETS[+btn.dataset.preset][1]];
    renderGradient();
    renderLamp();
    push();
  });
  $("stops").addEventListener("input", (e) => {
    if (e.target.dataset.index == null) return;
    s.gradient[+e.target.dataset.index] = e.target.value;
    renderGradientPresets();
    renderLamp();
    push();
  });
  $("stops").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.remove != null) s.gradient.splice(+btn.dataset.remove, 1);
    else if (btn.dataset.add != null) s.gradient.push(s.gradient[s.gradient.length - 1]);
    else return;
    renderGradient();
    renderLamp();
    push();
  });
  $("arrows").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    s.angle = +btn.dataset.angle;
    renderArrows();
    renderSlider("angle");
    renderLamp();
    push();
  });

  // Per side
  $("sides").addEventListener("input", (e) => {
    const row = e.target.closest(".side");
    if (!row) return;
    const side = s.sides[+row.dataset.index];
    if (e.target.type === "checkbox") side.on = e.target.checked;
    else side.color = e.target.value;
    renderSides();
    renderLamp();
    push();
  });

  for (const id of SLIDERS) {
    $(id).addEventListener("input", (e) => {
      s[id] = +e.target.value;
      renderSlider(id);
      if (id === "angle") renderArrows();
      renderLamp();
      push();
    });
  }

  $("monitor").addEventListener("change", (e) => {
    s.monitor = e.target.value;
    push();
  });

  $("language").addEventListener("change", (e) => {
    s.language = e.target.value;
    applyLanguage();
    push();
  });

  for (const id of ["hideFromCapture", "autoCamera", "avoidTaskbar", "settingsOnTop"]) {
    $(id).addEventListener("change", (e) => {
      s[id] = e.target.checked;
      push();
    });
  }

  $("autostart").addEventListener("change", async (e) => {
    try {
      s = await invoke("set_autostart", { enabled: e.target.checked });
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err);
    }
  });

  $("hotkey").addEventListener("click", () => (recording ? stopRecording() : startRecording()));
  $("hotkey").addEventListener("blur", () => recording && stopRecording());
  $("hotkeyClear").addEventListener("click", () => saveHotkey(""));

  // The tray panel and menu, the global shortcut and the camera change
  // settings too. While this window has focus the user is editing here, so
  // only take the fields that change elsewhere; otherwise take everything.
  listen("settings-changed", (e) => {
    const n = e.payload;
    if (!document.hasFocus() && !recording) {
      s = n;
      applyLanguage();
      return;
    }
    s.enabled = n.enabled;
    s.autostart = n.autostart;
    if (!recording) s.hotkey = n.hotkey;
    renderPower();
    $("autostart").checked = s.autostart;
    if (!recording) renderHotkey();
  });

  // Monitors may have been plugged in or out while the window was hidden.
  window.addEventListener("focus", async () => {
    monitors = await invoke("list_monitors");
    renderMonitors();
  });
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

async function init() {
  [s, info, monitors] = await Promise.all([invoke("get_settings"), invoke("app_info"), invoke("list_monitors")]);
  $("version").textContent = `v${info.version}`;
  buildStatic();
  bind();
  applyLanguage();
}

init();
