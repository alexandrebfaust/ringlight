// Helpers shared by the settings window and the tray panel.

const KELVIN_PRESETS = [
  [2700, "k_warm"],
  [3500, "k_soft"],
  [4500, "k_neutral"],
  [5600, "k_day"],
  [6500, "k_cool"],
];

/** Tanner Helland's approximation of black-body color at a temperature in Kelvin. */
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

/** CSS gradient across the 2000–9000 K range, for temperature sliders. */
function temperatureGradient() {
  const stops = [];
  for (let k = 2000; k <= 9000; k += 500) stops.push(kelvinToHex(k));
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** A single representative color of the current light, for small accents. */
function mainColor(s) {
  if (s.colorMode === "linear" || s.colorMode === "conic") return s.gradient[0];
  if (s.colorMode === "sides") return (s.sides.find((x) => x.on) ?? s.sides[0]).color;
  return s.color;
}

/** Effective UI language: the setting, or the Windows language on "auto". */
function resolveLanguage(s, info) {
  return s.language === "auto" ? info.systemLanguage : s.language;
}

function translate(lang, key, vars = {}) {
  let str = I18N[lang][key] ?? I18N.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
  return str;
}

/** Fills elements marked with data-i18n, data-i18n-title and data-i18n-aria. */
function translateDom(lang) {
  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = translate(lang, el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-title]")) el.title = translate(lang, el.dataset.i18nTitle);
  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", translate(lang, el.dataset.i18nAria));
  }
}

/**
 * Sends settings to the backend one call at a time, always with the latest
 * state, so dragging a slider doesn't queue dozens of calls.
 */
function createPusher(getSettings, onError) {
  let busy = false;
  let again = false;
  return async function push() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      await window.__TAURI__.core.invoke("update_settings", { settings: getSettings() });
    } catch (e) {
      onError(e);
    } finally {
      busy = false;
      if (again) {
        again = false;
        push();
      }
    }
  };
}
