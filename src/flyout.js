const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (id) => document.getElementById(id);

// The three temperatures offered in the panel (the full window has five).
const PANEL_PRESETS = KELVIN_PRESETS.filter(([k]) => k === 2700 || k === 5600 || k === 6500);
// Dial geometry, in the SVG's 120×120 viewBox: a 270° arc open at the bottom.
const R = 50;
const CIRCUMFERENCE = 2 * Math.PI * R;
const SWEEP = 270;
const START = 135; // degrees clockwise from 3 o'clock, i.e. bottom-left
const MIN = 10;
const MAX = 100;

let s = null;
let info = null;
let lang = "en";
let dragging = false;

const t = (key, vars) => translate(lang, key, vars);
const push = createPusher(() => s, (e) => console.error(e));

// ---------------------------------------------------------------- rendering

function renderDial() {
  const f = (s.intensity - MIN) / (MAX - MIN);
  const arc = (SWEEP / 360) * CIRCUMFERENCE;
  for (const [el, len] of [[document.querySelector(".dial .track"), arc], [$("dialValue"), arc * f]]) {
    el.setAttribute("stroke-dasharray", `${len} ${CIRCUMFERENCE}`);
    el.setAttribute("transform", `rotate(${START} 60 60)`);
  }
  const a = ((START + SWEEP * f) * Math.PI) / 180;
  $("dialKnob").setAttribute("cx", 60 + R * Math.cos(a));
  $("dialKnob").setAttribute("cy", 60 + R * Math.sin(a));
  $("dialText").innerHTML = `${s.intensity}<small>%</small>`;
  $("dial").setAttribute("aria-valuenow", s.intensity);
}

function render() {
  const panel = $("panel");
  panel.classList.toggle("off", !s.enabled);
  panel.style.setProperty("--c", mainColor(s));
  $("enabled").checked = s.enabled;
  $("status").textContent = t(s.enabled ? "status_on" : "status_off");
  renderDial();

  const solid = s.colorMode === "solid";
  for (const btn of $("presets").children) {
    btn.setAttribute("aria-pressed", String(solid && +btn.dataset.k === s.kelvin));
  }
  if (!dragging && s.kelvin != null) $("kelvin").value = s.kelvin;
  const out = $("kelvinOut");
  out.textContent = solid && s.kelvin != null ? `${s.kelvin} K` : "";
  // Keep the label on the side away from the thumb.
  const k = +$("kelvin").value;
  out.classList.toggle("right", k < (2000 + 9000) / 2);
  $("camera").setAttribute("aria-pressed", String(s.autoCamera));
}

function applyLanguage() {
  lang = resolveLanguage(s, info);
  translateDom(lang);
  render();
}

// ------------------------------------------------------------------ actions

function setIntensity(value) {
  const v = Math.round(Math.min(MAX, Math.max(MIN, value)));
  if (v === s.intensity) return;
  s.intensity = v;
  renderDial();
  push();
}

/** Maps a pointer position on the dial to an intensity. */
function intensityAt(e) {
  const box = $("dial").getBoundingClientRect();
  const dx = e.clientX - (box.left + box.width / 2);
  const dy = e.clientY - (box.top + box.height / 2);
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // clockwise from 3 o'clock
  const along = (deg - START + 720) % 360; // 0…360 along the arc
  // In the gap at the bottom, snap to whichever end is closer.
  const f = along <= SWEEP ? along / SWEEP : along < SWEEP + (360 - SWEEP) / 2 ? 1 : 0;
  return MIN + f * (MAX - MIN);
}

function setKelvin(k) {
  s.colorMode = "solid";
  s.kelvin = k;
  s.color = kelvinToHex(k);
  render();
  push();
}

function bind() {
  const dial = $("dial");
  dial.addEventListener("pointerdown", (e) => {
    dragging = true;
    dial.setPointerCapture(e.pointerId);
    setIntensity(intensityAt(e));
  });
  dial.addEventListener("pointermove", (e) => dragging && setIntensity(intensityAt(e)));
  const stop = () => (dragging = false);
  dial.addEventListener("pointerup", stop);
  dial.addEventListener("pointercancel", stop);
  dial.addEventListener("wheel", (e) => {
    e.preventDefault();
    setIntensity(s.intensity + (e.deltaY < 0 ? 5 : -5));
  });
  dial.addEventListener("keydown", (e) => {
    const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 10, PageDown: -10 }[e.key];
    if (e.key === "Home") setIntensity(MIN);
    else if (e.key === "End") setIntensity(MAX);
    else if (step) setIntensity(s.intensity + step);
    else return;
    e.preventDefault();
  });

  $("presets").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) setKelvin(+btn.dataset.k);
  });
  const kelvin = $("kelvin");
  kelvin.addEventListener("pointerdown", () => (dragging = true));
  kelvin.addEventListener("pointerup", () => (dragging = false));
  kelvin.addEventListener("input", (e) => setKelvin(+e.target.value));

  $("camera").addEventListener("click", () => {
    s.autoCamera = !s.autoCamera;
    render();
    push();
  });

  $("enabled").addEventListener("change", async (e) => {
    s = await invoke("set_enabled", { enabled: e.target.checked });
    render();
  });

  $("open").addEventListener("click", () => invoke("open_settings"));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") invoke("hide_flyout");
  });
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // Changes from the settings window, tray menu, shortcut or camera. While
  // the user is dragging here, keep the local value under the pointer.
  listen("settings-changed", (e) => {
    const intensity = s.intensity;
    s = e.payload;
    if (dragging) s.intensity = intensity;
    applyLanguage();
  });

  // The backend shows this window on each tray click: refresh and slide in.
  listen("flyout-shown", async () => {
    s = await invoke("get_settings");
    applyLanguage();
    $("panel").animate(
      [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
      { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    $("dial").focus({ preventScroll: true });
  });
}

function buildPresets() {
  for (const [k, key] of PANEL_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.k = k;
    btn.title = `${k} K`;
    btn.style.setProperty("--c", kelvinToHex(k));
    btn.innerHTML = `<i></i><span data-i18n="${key}"></span>`;
    $("presets").append(btn);
  }
  $("kelvin").parentElement.style.setProperty("--temp-gradient", temperatureGradient());
}

async function init() {
  [s, info] = await Promise.all([invoke("get_settings"), invoke("app_info")]);
  buildPresets();
  bind();
  applyLanguage();
}

init();
