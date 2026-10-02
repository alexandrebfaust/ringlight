// Paints the light colors and runs the effects. Shared by overlay.html (the
// real ring) and the settings window (the preview lamp).
//
// Expected markup: root > .fx > .spin > .paint
//   .fx     pulse and color-cycle effects
//   .spin   rotation of the conic gradient
//   .paint  the colors, dimmed by `intensity`
(function () {
  // Degrees of blending on each side of a corner in "per side" mode.
  const SIDE_BLEND = 5;

  // Effect period in seconds at speed 1 (slow) and 10 (fast).
  const PERIOD = { rotate: [60, 4], pulse: [8, 1.5], hue: [60, 5] };

  function period(effect, speed) {
    const [slow, fast] = PERIOD[effect];
    return 1000 * slow * Math.pow(fast / slow, (speed - 1) / 9);
  }

  /** One color per side, split along the diagonals of a w×h area. */
  function sidesGradient(sides, w, h) {
    const a = (Math.atan2(w, h) * 180) / Math.PI; // from the top to the top-right corner
    const b = SIDE_BLEND;
    const [top, right, bottom, left] = sides.map((s) => (s.on ? s.color : "transparent"));
    return (
      `conic-gradient(${top} 0deg ${a - b}deg, ` +
      `${right} ${a + b}deg ${180 - a - b}deg, ` +
      `${bottom} ${180 - a + b}deg ${180 + a - b}deg, ` +
      `${left} ${180 + a + b}deg ${360 - a - b}deg, ` +
      `${top} ${360 - a + b}deg)`
    );
  }

  function background(s, w, h) {
    switch (s.colorMode) {
      case "linear":
        return `linear-gradient(var(--angle), ${s.gradient.join(", ")})`;
      case "conic":
        // Repeat the first color at the end so the loop has no seam.
        return `conic-gradient(${[...s.gradient, s.gradient[0]].join(", ")})`;
      case "sides":
        return sidesGradient(s.sides, w, h);
      default:
        return s.color;
    }
  }

  /** The effect that actually runs: "rotate" only applies to gradients. */
  function activeEffect(s) {
    if (s.effect === "rotate" && s.colorMode !== "linear" && s.colorMode !== "conic") return "none";
    return s.effect;
  }

  class RingPaint {
    constructor(root) {
      this.root = root;
      this.fx = root.querySelector(".fx");
      this.spin = root.querySelector(".spin");
      this.paint = root.querySelector(".paint");
      this.anim = null;
      this.animKey = "none";
    }

    /** Applies settings `s` to a w×h area. `animate` = false stops the effects. */
    update(s, w, h, animate) {
      this.root.dataset.mode = s.colorMode;
      this.root.style.setProperty("--d", `${Math.ceil(Math.hypot(w, h))}px`);
      const paint = this.paint.style;
      paint.background = background(s, w, h);
      paint.filter = `brightness(${s.intensity / 100})`;
      paint.setProperty("--angle", `${s.angle}deg`);
      this.spin.style.transform = s.colorMode === "conic" ? `rotate(${s.angle}deg)` : "";
      this.runEffect(animate ? activeEffect(s) : "none", s);
    }

    runEffect(effect, s) {
      const key = effect === "none" ? "none" : [effect, s.colorMode, s.angle, s.speed].join("|");
      if (key === this.animKey) return;

      // Keep the phase when only the speed changed, so the slider doesn't jump.
      let progress = 0;
      if (this.anim && this.animKey.split("|").slice(0, 3).join("|") === key.split("|").slice(0, 3).join("|")) {
        const dur = this.anim.effect.getTiming().duration;
        progress = (this.anim.currentTime % dur) / dur;
      }
      this.anim?.cancel();
      this.anim = null;
      this.animKey = key;
      if (effect === "none") return;

      const duration = period(effect, s.speed);
      const timing = { duration, iterations: Infinity };
      const a = s.angle;
      if (effect === "rotate" && s.colorMode === "conic") {
        this.anim = this.spin.animate([{ transform: `rotate(${a}deg)` }, { transform: `rotate(${a + 360}deg)` }], timing);
      } else if (effect === "rotate") {
        this.anim = this.paint.animate([{ "--angle": `${a}deg` }, { "--angle": `${a + 360}deg` }], timing);
      } else if (effect === "pulse") {
        this.anim = this.fx.animate([{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }], { ...timing, easing: "ease-in-out" });
      } else if (effect === "hue") {
        this.anim = this.fx.animate([{ filter: "hue-rotate(0deg)" }, { filter: "hue-rotate(360deg)" }], timing);
      }
      if (this.anim) this.anim.currentTime = progress * duration;
    }
  }

  RingPaint.activeEffect = activeEffect;
  window.RingPaint = RingPaint;
})();
