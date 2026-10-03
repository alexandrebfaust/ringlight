// Runs in the page's own JavaScript world, before the page's scripts, to see
// when the page turns the camera on or off and when it shares the screen.
// It only reports two booleans to the extension's content script
// (overlay.js), through a DOM event.
(() => {
  const devices = navigator.mediaDevices;
  if (!devices || devices.__ringlight) return;
  Object.defineProperty(devices, "__ringlight", { value: true });

  const camera = new Set();
  const screen = new Set();
  let last = "";

  const anyLive = (tracks) => {
    for (const track of tracks) {
      if (track.readyState === "live") return true;
      tracks.delete(track);
    }
    return false;
  };

  function report(force = false) {
    const state = JSON.stringify({ camera: anyLive(camera), sharing: anyLive(screen) });
    if (state === last && !force) return;
    last = state;
    document.dispatchEvent(new CustomEvent("ringlight:media", { detail: state }));
  }

  function watch(track, tracks) {
    tracks.add(track);
    track.addEventListener("ended", () => report());
  }

  for (const [name, tracks] of [["getUserMedia", camera], ["getDisplayMedia", screen]]) {
    const original = devices[name];
    if (typeof original !== "function") continue;
    devices[name] = function (...args) {
      return original.apply(this, args).then((stream) => {
        for (const track of stream.getVideoTracks()) watch(track, tracks);
        report();
        return stream;
      });
    };
  }

  // stop() doesn't fire "ended", and video apps often keep clones of tracks.
  const proto = MediaStreamTrack.prototype;
  const stop = proto.stop;
  proto.stop = function () {
    stop.call(this);
    if (camera.has(this) || screen.has(this)) report();
  };
  const clone = proto.clone;
  proto.clone = function () {
    const copy = clone.call(this);
    for (const tracks of [camera, screen]) if (tracks.has(this)) watch(copy, tracks);
    return copy;
  };

  document.addEventListener("ringlight:query", () => report(true));
  // Tracks can also end without any event (e.g. the camera is unplugged).
  setInterval(() => {
    if (camera.size || screen.size) report();
  }, 2000);
})();
