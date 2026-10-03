// Generated from src/flyout.js by scripts/sync-extension.mjs. Edit the original.
const $ = (id) => document.getElementById(id);
// Set right away: in the extension the popup sizes itself from the page.
document.documentElement.dataset.host = Backend.kind;

// The three temperatures offered in the panel (the full window has five).
const PANEL_PRESETS = KELVIN_PRESETS.filter(([k]) => k === 2700 || k === 5600 || k === 6500);
const SLIDERS = ["speed", "opacity", "thickness", "softness", "radius"];
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

/** In the browser the switch belongs to the current tab. */
function statusText() {
  if (Backend.kind !== "extension") return t(s.enabled ? "status_on" : "status_off");
  const tab = Backend.tab();
  if (!tab.available) return t("tab_unavailable");
  if (tab.lit) return t(tab.manual === true ? "status_tab_on" : "status_tab_camera");
  return t(s.autoCamera ? "status_camera" : "status_off");
}

function renderSeg(id, value) {
  for (const btn of $(id).children) btn.setAttribute("aria-checked", String(btn.dataset.value === value));
}

function renderSlider(id) {
  const input = $(id);
  input.value = s[id];
  input.style.setProperty("--p", `${((s[id] - input.min) / (input.max - input.min)) * 100}%`);
  document.querySelector(`output[data-for="${id}"]`).textContent = s[id] + input.dataset.unit;
}

function renderMore() {
  renderSeg("shape", s.shape);
  // Rounded corners only exist on the rectangle.
  $("radius").disabled = s.shape !== "frame";
  $("radius").closest(".mini-slider").classList.toggle("disabled", s.shape !== "frame");
  renderSeg("colorMode", s.colorMode);
  for (const el of document.querySelectorAll("[data-panel]")) {
    el.hidden = !el.dataset.panel.split(" ").includes(s.colorMode);
  }
  GRADIENT_PRESETS.forEach(([, colors], i) => {
    $("gradients").children[i].setAttribute("aria-pressed", String(sameColors(colors, s.gradient)));
  });
  s.sides.forEach((side, i) => {
    const btn = $("sides").children[i];
    btn.classList.toggle("off", !side.on);
    btn.setAttribute("aria-pressed", String(side.on));
    btn.style.setProperty("--c", side.color);
  });

  renderSeg("effect", s.effect);
  $("effect").querySelector('[data-value="rotate"]').disabled = !isGradientMode(s) && s.effect !== "rotate";
  $("speedRow").hidden = s.effect === "none";
  SLIDERS.forEach(renderSlider);
}

function render() {
  const panel = $("panel");
  panel.classList.toggle("off", !s.enabled);
  panel.style.setProperty("--c", mainColor(s));
  $("enabled").checked = s.enabled;
  $("enabled").disabled = Backend.kind === "extension" && !Backend.tab().available;
  $("status").textContent = statusText();
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
  if ($("shrinkPage")) $("shrinkPage").checked = s.shrinkPage;

  renderMore();
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

/** Applies a change made by a click, then redraws and saves. */
function change(apply) {
  apply();
  render();
  push();
}

function onButton(id, handler) {
  $(id).addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn && !btn.disabled) handler(btn);
  });
}

function bind() {
  const dial = $("dial");
  dial.addEventListener("pointerdown", (e) => {
    dial.setPointerCapture(e.pointerId);
    setIntensity(intensityAt(e));
  });
  dial.addEventListener("pointermove", (e) => dragging && setIntensity(intensityAt(e)));
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
  // While anything is being dragged, incoming changes must not move it.
  for (const el of [dial, $("kelvin"), ...SLIDERS.map($)]) {
    el.addEventListener("pointerdown", () => (dragging = true), { capture: true });
  }
  window.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("pointercancel", () => (dragging = false));

  onButton("presets", (btn) => setKelvin(+btn.dataset.k));
  $("kelvin").addEventListener("input", (e) => setKelvin(+e.target.value));
  $("camera").addEventListener("click", () => change(() => (s.autoCamera = !s.autoCamera)));
  $("shrinkPage")?.addEventListener("change", (e) => change(() => (s.shrinkPage = e.target.checked)));

  onButton("shape", (btn) => change(() => (s.shape = btn.dataset.value)));
  onButton("colorMode", (btn) => change(() => (s.colorMode = btn.dataset.value)));
  onButton("gradients", (btn) => change(() => (s.gradient = [...GRADIENT_PRESETS[+btn.dataset.preset][1]])));
  onButton("sides", (btn) => change(() => (s.sides[+btn.dataset.side].on = !s.sides[+btn.dataset.side].on)));
  onButton("effect", (btn) => change(() => (s.effect = btn.dataset.value)));
  for (const id of SLIDERS) {
    $(id).addEventListener("input", (e) => {
      s[id] = +e.target.value;
      renderSlider(id);
      push();
    });
  }

  $("enabled").addEventListener("change", async (e) => {
    s = await Backend.setEnabled(e.target.checked);
    render();
  });

  $("open").addEventListener("click", () => Backend.openSettings());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") Backend.closePanel();
  });
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // Changes from the settings window, tray menu, shortcut or camera. While
  // the user is dragging here, keep the local values under the pointer.
  Backend.onChange((next) => {
    if (dragging) {
      s.enabled = next.enabled;
      return;
    }
    s = next;
    applyLanguage();
  });

  // The desktop panel is a window of its own: it follows the content's height.
  new ResizeObserver(() => Backend.resizePanel(Math.ceil($("panel").getBoundingClientRect().height))).observe(
    $("panel"),
  );

  // Each time the panel opens: refresh and slide in.
  Backend.onPanelShown(async () => {
    ({ settings: s } = await Backend.load());
    applyLanguage();
    $("panel").animate(
      [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
      { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    $("dial").focus({ preventScroll: true });
  });
}

function buildStatic() {
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

  GRADIENT_PRESETS.forEach(([key, colors], i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.preset = i;
    btn.dataset.i18nTitle = key;
    btn.dataset.i18nAria = key;
    btn.style.setProperty("--g", `linear-gradient(90deg, ${colors.join(", ")})`);
    btn.innerHTML = '<span class="swatch"></span>';
    $("gradients").append(btn);
  });
  $("gradients").style.setProperty("--n", GRADIENT_PRESETS.length);

  SIDE_KEYS.forEach((key, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.side = i;
    btn.innerHTML = `<span class="dot"></span><span data-i18n="${key}"></span>`;
    $("sides").append(btn);
  });
  $("sides").style.setProperty("--n", SIDE_KEYS.length);
}

async function init() {
  // Drop what this host doesn't have.
  for (const el of document.querySelectorAll("[data-feature]")) {
    if (!Backend.features.has(el.dataset.feature)) el.remove();
  }
  ({ settings: s, info } = await Backend.load());
  buildStatic();
  bind();
  applyLanguage();
}

init();
