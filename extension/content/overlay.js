// Draws the ring light inside the page. Runs in every top-level page and stays
// hidden until the light is switched on in this tab (toolbar icon or shortcut)
// or the page starts using the camera.
//
// Pages can have strict CSP and their own CSS, so the overlay lives in a
// closed shadow root and is styled only through CSSOM (no <style>, no data:
// URLs). Its shape is a clip-path with a rounded hole; a blur on the wrapper
// softens the inner edge, like the SVG mask does in the desktop app.
(() => {
  if (window.top !== window) return;

  const FADE_MS = 400;
  // Space between the shrunk page and the middle of the band's fade, px.
  const SHRINK_GAP = 6;
  const SHRINK_MIN = 0.25;
  const NO_CHILDREN = /^(VIDEO|IMG|CANVAS|IFRAME|EMBED|OBJECT|AUDIO)$/;

  let settings = null;
  /** This tab's switch: true (on), false (off even with the camera) or null (follow the camera). */
  let manual = null;
  let camera = false;
  let sharing = false;
  let shown = false;
  let hideTimer = 0;

  try {
    // @property doesn't work inside shadow roots; register it on the page.
    CSS.registerProperty({ name: "--rl-angle", syntax: "<angle>", inherits: false, initialValue: "0deg" });
  } catch {
    // Already registered (e.g. the script ran twice).
  }

  const host = document.createElement("ringlight-overlay");
  host.style.cssText =
    "all: initial !important; display: none !important; position: fixed !important; inset: 0 !important;" +
    "z-index: 2147483647 !important; pointer-events: none !important;";
  const root = host.attachShadow({ mode: "closed" });

  const div = (parent, className) => {
    const el = document.createElement("div");
    if (className) el.className = className;
    parent.append(el);
    return el;
  };
  const ring = div(root); // opacity and fade
  const soft = div(ring); // blur that softens the inner edge
  const band = div(soft); // clip-path: the band itself
  const fx = div(band, "fx");
  const spin = div(fx, "spin");
  const paint = div(spin, "paint");
  Object.assign(ring.style, { position: "fixed", inset: "0", opacity: "0", transition: "opacity 0.3s ease" });
  Object.assign(soft.style, { position: "absolute", inset: "0" });
  Object.assign(band.style, { position: "absolute", overflow: "hidden" });
  for (const el of [fx, paint]) Object.assign(el.style, { position: "absolute", inset: "0" });
  const painter = new RingPaint(band);

  const ellipsePath = (cx, cy, rx, ry) =>
    `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;

  /**
   * The band's area for clip-path's even-odd rule: the outer rectangle minus
   * a hole in the middle, shaped by `shape` (see overlay.html in the app).
   * `margin` is how far the band element reaches past the viewport.
   */
  function bandPath(s, w, h, margin) {
    const inset = margin + s.thickness + s.softness / 2;
    let d = `M0 0H${w}V${h}H0Z`;
    if (s.shape === "oval" || s.shape === "circle") {
      const rx = w / 2 - inset;
      const ry = s.shape === "circle" ? rx : h / 2 - inset;
      if (rx > 0 && ry > 0) d += ellipsePath(w / 2, h / 2, rx, ry);
      return d;
    }
    if (s.shape === "bars") {
      // A strip as tall as the band element: only the sides stay lit.
      const hw = w - 2 * inset;
      if (hw > 0) d += `M${inset} 0H${inset + hw}V${h}H${inset}Z`;
      return d;
    }
    const radius = s.radius;
    const hw = w - 2 * inset;
    const hh = h - 2 * inset;
    if (hw > 0 && hh > 0) {
      const r = Math.min(radius, hw / 2, hh / 2);
      const [x, y] = [inset, inset];
      d +=
        `M${x + r} ${y}H${x + hw - r}A${r} ${r} 0 0 1 ${x + hw} ${y + r}V${y + hh - r}` +
        `A${r} ${r} 0 0 1 ${x + hw - r} ${y + hh}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + hh - r}` +
        `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    }
    return d;
  }

  /** The conic gradient rotates by transform, on a square as wide as the diagonal. */
  function sizeSpin(mode, w, h) {
    if (mode === "conic") {
      const d = Math.ceil(Math.hypot(w, h));
      spin.style.cssText = `position: absolute; left: ${(w - d) / 2}px; top: ${(h - d) / 2}px; width: ${d}px; height: ${d}px;`;
    } else {
      spin.style.cssText = "position: absolute; inset: 0;";
    }
  }

  function render(animate) {
    const s = settings;
    const { width, height } = ring.getBoundingClientRect();
    if (!s || !width || !height) return;

    // Extend past the viewport so the blur never fades the band at the page edge.
    const margin = Math.ceil(s.softness * 1.5) + 2;
    const w = width + 2 * margin;
    const h = height + 2 * margin;
    Object.assign(band.style, {
      left: `${-margin}px`,
      top: `${-margin}px`,
      width: `${w}px`,
      height: `${h}px`,
      clipPath: `path(evenodd, "${bandPath(s, w, h, margin)}")`,
    });
    soft.style.filter = s.softness > 0 ? `blur(${s.softness / 2}px)` : "none";
    sizeSpin(s.colorMode, w, h);
    painter.update(s, w, h, animate);
    ring.style.opacity = shown ? String(s.opacity / 100) : "0";
  }

  /** In fullscreen, the light has to live inside the fullscreen element to be seen. */
  function attach() {
    const fs = document.fullscreenElement;
    const parent = fs && !NO_CHILDREN.test(fs.tagName) ? fs : document.documentElement;
    if (parent && host.parentNode !== parent) parent.append(host);
  }

  let lastLit = null;
  function tellToolbar() {
    // Keeps the toolbar icon colored in a tab lit by its camera.
    if (lastLit === shown && !shown) return;
    lastLit = shown;
    try {
      chrome.runtime.sendMessage({ type: "lit", lit: shown }).catch(() => {});
    } catch {
      // The extension was reloaded; this old content script is orphaned.
    }
  }

  function hideNow() {
    clearTimeout(hideTimer);
    render(false); // also stops the effects
    host.style.setProperty("display", "none", "important");
  }

  // ------------------------------------------------------------ shrink page
  // Fits the page into the clear area inside the light. The light hangs
  // directly off <html>, so shrinking <body> leaves it untouched.
  //
  // App-like pages that fill the window without scrolling (Gmail, Meet,
  // Teams…) are scaled just enough to fit, and their layout box is stretched
  // in the other direction, so they fill the whole clear area. The box is
  // never smaller than the window, so layouts sized in vw/vh still fit. The
  // transform also makes <body> the containing block of fixed elements.
  //
  // Long pages that scroll are scaled around the middle of the screen and
  // clipped to what was on screen, so content doesn't slide under the light.
  let shrink = null; // { saved, savedRoot, base, fill } while the page is shrunk
  let unshrinkTimer = 0;
  const SHRINK_PROPS = [
    "transform",
    "transform-origin",
    "transition",
    "clip-path",
    "margin",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
  ];

  /** The largest rectangle (viewport px) that stays clear of the light. */
  function clearRect(w, h) {
    const band = settings.thickness + settings.softness / 2 + SHRINK_GAP;
    switch (settings.shape) {
      case "bars":
        return { x: band, y: 0, w: w - 2 * band, h };
      case "oval":
      case "circle": {
        const rx = w / 2 - band;
        const ry = settings.shape === "circle" ? rx : h / 2 - band;
        if (rx <= 0 || ry <= 0) return null;
        // Largest rectangle inside the ellipse, no taller than the screen
        // (a big circle runs past the top and bottom).
        const hy = Math.min(ry / Math.SQRT2, h / 2);
        const hx = rx * Math.sqrt(1 - (hy / ry) ** 2);
        return { x: w / 2 - hx, y: h / 2 - hy, w: 2 * hx, h: 2 * hy };
      }
      default:
        return { x: band, y: band, w: w - 2 * band, h: h - 2 * band };
    }
  }

  function setStyles(el, styles) {
    for (const [prop, value] of Object.entries(styles)) el.style.setProperty(prop, value, "important");
  }

  function applyShrink() {
    const body = document.body;
    if (!(shown && settings?.shrinkPage && body && !document.fullscreenElement)) return unshrink();
    clearTimeout(unshrinkTimer);
    unshrinkTimer = 0;

    const root = document.documentElement;
    const w = root.clientWidth; // without the scrollbar
    const h = root.clientHeight;
    const rect = clearRect(w, h);
    if (!rect || rect.w <= 0 || rect.h <= 0) return unshrink();
    const k = Math.min(1, Math.max(SHRINK_MIN, Math.min(rect.w / w, rect.h / h)));

    if (!shrink) {
      // Remember the page's own inline values, then measure <body> unscaled.
      const saved = SHRINK_PROPS.map((p) => [p, body.style.getPropertyValue(p), body.style.getPropertyPriority(p)]);
      const scroller = document.scrollingElement ?? root;
      const fill = scroller.scrollHeight <= h + 1 && scroller.scrollWidth <= w + 1;
      // The stretched box still counts toward the document's size (transforms
      // don't change layout), so hide the scrollbars it would bring. The page
      // didn't scroll before, so nothing is lost.
      const savedRoot = [root.style.getPropertyValue("overflow"), root.style.getPropertyPriority("overflow")];
      if (fill) {
        setStyles(root, { overflow: "hidden" });
        setStyles(body, { margin: "0" });
      }
      const r = body.getBoundingClientRect();
      shrink = { saved, savedRoot, fill, base: { x: r.left + scrollX, y: r.top + scrollY } };
    }

    if (shrink.fill) {
      // Lay the page out in a box that, scaled by k, covers the clear area.
      setStyles(body, {
        width: `${rect.w / k}px`,
        height: `${rect.h / k}px`,
        "min-width": "0",
        "min-height": "0",
        "max-width": "none",
        "max-height": "none",
        "transform-origin": "0 0",
        "clip-path": "inset(0)",
        transition: "transform 0.3s ease",
        transform: `translate(${rect.x - shrink.base.x}px, ${rect.y - shrink.base.y}px) scale(${k})`,
      });
      return;
    }

    // Scale around the middle of what's on screen, in <body>'s coordinates.
    const left = scrollX - shrink.base.x;
    const top = scrollY - shrink.base.y;
    const right = body.offsetWidth - (left + w);
    const bottom = body.offsetHeight - (top + h);
    setStyles(body, {
      "clip-path": `inset(${top}px ${right}px ${bottom}px ${left}px)`,
      transition: "transform 0.3s ease",
      "transform-origin": `${left + w / 2}px ${top + h / 2}px`,
      transform: `scale(${k})`,
    });
  }

  function restoreBody() {
    const body = document.body;
    if (!shrink) return;
    for (const [prop, value, priority] of shrink.saved) {
      if (value) body?.style.setProperty(prop, value, priority);
      else body?.style.removeProperty(prop);
    }
    if (shrink.fill) {
      const [value, priority] = shrink.savedRoot;
      const root = document.documentElement;
      if (value) root.style.setProperty("overflow", value, priority);
      else root.style.removeProperty("overflow");
    }
    shrink = null;
  }

  function unshrink() {
    if (!shrink || unshrinkTimer) return;
    // A stretched layout box can't animate back; restore it right away.
    if (shrink.fill) return restoreBody();
    document.body?.style.setProperty("transform", "scale(1)", "important");
    // After the transition, give the page back its own inline styles.
    unshrinkTimer = setTimeout(() => {
      unshrinkTimer = 0;
      restoreBody();
    }, FADE_MS);
  }

  function update() {
    if (!settings) return;
    const want =
      (manual === true || (manual !== false && settings.autoCamera && camera)) &&
      !(settings.hideWhileSharing && sharing);
    clearTimeout(hideTimer);
    const appearing = want && !shown;
    shown = want;
    tellToolbar();

    if (shown) {
      attach();
      host.style.setProperty("display", "block", "important");
      if (appearing) {
        // Lay out at opacity 0 first so the fade-in runs.
        ring.style.opacity = "0";
        requestAnimationFrame(() => requestAnimationFrame(() => render(true)));
      } else {
        render(true);
      }
    } else if (document.visibilityState === "hidden") {
      // Nobody sees the fade in a background tab, and Chrome holds back its
      // timers there, so the hide could otherwise wait a long time.
      hideNow();
    } else {
      render(true); // fades out, effects still running
      hideTimer = setTimeout(hideNow, FADE_MS);
    }
    applyShrink();
  }

  function start() {
    attach();
    new MutationObserver(() => shown && !host.isConnected && attach()).observe(document.documentElement, {
      childList: true,
    });
    document.addEventListener("fullscreenchange", () => {
      attach();
      if (shown) render(true);
      applyShrink();
    });
    window.addEventListener("resize", () => {
      if (shown) render(true);
      applyShrink();
    });
    // Keep scaling around the middle of the screen as the page scrolls.
    window.addEventListener("scroll", () => shrink && applyShrink(), { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && !shown) hideNow();
    });

    document.addEventListener("ringlight:media", (e) => {
      ({ camera, sharing } = JSON.parse(e.detail));
      update();
    });
    document.dispatchEvent(new CustomEvent("ringlight:query"));

    const state = () => ({ lit: shown, camera, manual });
    chrome.runtime.onMessage.addListener((message, _sender, reply) => {
      if (message?.type === "state") reply(state());
      else if (message?.type === "tab-state") {
        manual = message.manual;
        update();
        reply(state());
      }
    });
    chrome.runtime
      .sendMessage({ type: "hello" })
      .then((reply) => {
        manual = reply?.manual ?? null;
        update();
      })
      .catch(() => {});

    RinglightStore.get().then((s) => {
      settings = s;
      update();
    });
    RinglightStore.onChange((s) => {
      settings = s;
      update();
    });
  }

  // At document_start the page may not even have its <html> element yet.
  if (document.documentElement) start();
  else {
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return;
      observer.disconnect();
      start();
    }).observe(document, { childList: true });
  }
})();
