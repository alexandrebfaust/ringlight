const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (id) => document.getElementById(id);

const PRESETS = [
  [2700, "Quente"],
  [3500, "Suave"],
  [4500, "Neutra"],
  [5600, "Dia"],
  [6500, "Fria"],
];
const SLIDERS = ["brightness", "thickness", "softness", "radius"];

/** Aproximação de Tanner Helland da cor de um corpo negro em Kelvin. */
function kelvinToHex(kelvin) {
  const t = kelvin / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const hex = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

let s = null; // configurações atuais

// --------------------------------------------------------------- envio

// Um update por vez, sempre com o estado mais recente: arrastar um slider
// não enfileira dezenas de chamadas.
let busy = false;
let again = false;
async function push() {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    await invoke("update_settings", { settings: s });
  } catch (e) {
    toast(e);
  } finally {
    busy = false;
    if (again) {
      again = false;
      push();
    }
  }
}

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = String(message);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

// ---------------------------------------------------------- renderização

function renderPower() {
  $("enabled").checked = s.enabled;
  $("status").textContent = s.enabled ? "Ligada" : "Desligada";
  renderLamp();
}

function renderLamp() {
  const lamp = $("lamp");
  lamp.classList.toggle("off", !s.enabled);
  lamp.style.setProperty("--c", s.color);
  lamp.style.setProperty("--a", String(s.brightness / 100));
}

function renderColor() {
  const kelvin = $("kelvin");
  if (s.kelvin != null) kelvin.value = s.kelvin;
  $("kelvinOut").textContent = s.kelvin != null ? `${s.kelvin} K` : "personalizada";
  kelvin.style.setProperty("--thumb", s.kelvin != null ? s.color : kelvinToHex(+kelvin.value));
  $("color").value = s.color;
  $("colorHex").textContent = s.color;
  for (const btn of $("presets").children) {
    btn.setAttribute("aria-pressed", String(+btn.dataset.k === s.kelvin));
  }
  renderLamp();
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
  btn.textContent = s.hotkey ? hotkeyLabel(s.hotkey) : "Nenhum";
  $("hotkeyClear").hidden = !s.hotkey;
}

async function renderMonitors() {
  const select = $("monitor");
  const monitors = await invoke("list_monitors");
  select.replaceChildren(
    new Option("Monitor principal", "primary"),
    new Option("Todos os monitores", "all"),
    ...monitors.map((m) => new Option(m.label, m.id)),
  );
  select.value = s.monitor;
  if (select.value !== s.monitor) select.value = "primary";
}

function renderAll() {
  renderPower();
  renderColor();
  SLIDERS.forEach(renderSlider);
  $("hideFromCapture").checked = s.hideFromCapture;
  $("autoCamera").checked = s.autoCamera;
  $("autostart").checked = s.autostart;
  renderHotkey();
}

// ---------------------------------------------------------------- cor

function buildPresets() {
  const box = $("presets");
  for (const [k, name] of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.k = k;
    btn.title = `${name} · ${k} K`;
    btn.style.setProperty("--c", kelvinToHex(k));
    btn.innerHTML = `<i></i>${name}<small>${k} K</small>`;
    btn.addEventListener("click", () => setKelvin(k));
    box.append(btn);
  }

  const stops = [];
  for (let k = 2000; k <= 9000; k += 500) stops.push(kelvinToHex(k));
  $("kelvin").style.setProperty("--temp-gradient", `linear-gradient(to right, ${stops.join(", ")})`);
}

function setKelvin(k) {
  s.kelvin = k;
  s.color = kelvinToHex(k);
  renderColor();
  push();
}

// ------------------------------------------------------------- atalho

let recording = false;

function startRecording() {
  recording = true;
  const btn = $("hotkey");
  btn.classList.add("recording");
  btn.classList.remove("empty");
  btn.textContent = "Pressione as teclas…";
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
    const isFn = /^F\d+$/.test(e.code);
    if (!mods.length && !isFn) {
      $("hotkey").textContent = "Use Ctrl, Alt ou Shift + tecla";
      return;
    }
    saveHotkey([...mods, e.code].join("+"));
  },
  true,
);

// ------------------------------------------------------------- eventos

function bind() {
  $("enabled").addEventListener("change", async (e) => {
    s = await invoke("set_enabled", { enabled: e.target.checked });
    renderPower();
  });

  $("kelvin").addEventListener("input", (e) => setKelvin(+e.target.value));

  $("color").addEventListener("input", (e) => {
    s.color = e.target.value;
    s.kelvin = null;
    renderColor();
    push();
  });

  for (const id of SLIDERS) {
    $(id).addEventListener("input", (e) => {
      s[id] = +e.target.value;
      renderSlider(id);
      renderLamp();
      push();
    });
  }

  $("monitor").addEventListener("change", (e) => {
    s.monitor = e.target.value;
    push();
  });

  for (const id of ["hideFromCapture", "autoCamera"]) {
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

  // Bandeja, atalho global e câmera também ligam/desligam a luz.
  listen("settings-changed", (e) => {
    const n = e.payload;
    s.enabled = n.enabled;
    s.autostart = n.autostart;
    if (!recording) s.hotkey = n.hotkey;
    renderPower();
    $("autostart").checked = s.autostart;
    if (!recording) renderHotkey();
  });

  // Monitores podem ter sido conectados/desconectados com a janela escondida.
  window.addEventListener("focus", () => renderMonitors());
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

async function init() {
  s = await invoke("get_settings");
  buildPresets();
  renderAll();
  bind();
  await renderMonitors();
}

init();
