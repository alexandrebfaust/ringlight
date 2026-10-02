# Ringlight

A screen ring light for video calls: it lights up a band around the edge of your
monitor to light your face on camera. The band always stays on top, but clicks go
straight through it, so you keep using your computer normally.

Built with [Tauri 2](https://tauri.app) (Rust + HTML). Windows only for now. The
interface is in English or Portuguese, following the Windows display language.

## Features

**Light**

- **Colors**:
  - **Solid**: temperature presets (2700 K to 6500 K), a 2000–9000 K slider or any color.
  - **Gradient**: 2–5 colors across the screen, at any angle.
  - **Conic**: colors that sweep around the screen.
  - **Per side**: a color for each side, each side on or off. Useful for a key and fill light setup.
- **Effects**: rotate, pulse or color cycle, with adjustable speed. They stop while the light is off.
- **Opacity** makes the band see-through. **Intensity** dims the color while the band stays solid.
- **Thickness**, **softness** (fade toward the center) and **rounded corners**.

**Tray**

- **Quick panel**: one click on the tray icon opens a small panel with an intensity dial,
  temperature presets, a temperature bar, the camera toggle and the on/off switch.
- **Double-click** opens the full settings. **Right-click** opens the menu.
- The tray icon is drawn with the current light colors.

**Automation**

- **Hide when sharing the screen**: the light uses `WDA_EXCLUDEFROMCAPTURE`, so it
  doesn't show up in Teams, Meet, Zoom, OBS or screenshots.
- **Turn on with the camera**: lights up when an app starts using the webcam and turns
  off when it stops (only if the camera was what turned it on).
- **Global shortcut**, `Ctrl + Alt + L` by default.
- **Start with Windows**: opens in the tray with the light off.

**Displays**

- Light up the primary display, all displays or a specific one. The overlays follow
  displays being plugged in, unplugged or changing resolution.

## Building

Requirements:

- Node.js
- Rust via rustup. `rust-toolchain.toml` pins the **1.90 GNU** toolchain
  (`x86_64-pc-windows-gnu`), which doesn't need the Visual Studio C++ tools:
  `rustup toolchain install 1.90-x86_64-pc-windows-gnu`
- MinGW-w64 on `PATH`. Its `windres` embeds the icon and manifest into the `.exe`.
- WebView2, which ships with Windows 11.

To build with MSVC instead, install "Desktop development with C++" in Visual Studio
and set the channel in `rust-toolchain.toml` to `"1.90"`.

```bash
npm install
npm run dev      # development mode
npm run build    # executable and installer
```

Build output:

- `src-tauri/target/release/ringlight.exe`: standalone executable
- `src-tauri/target/release/bundle/nsis/Ringlight_<version>_x64-setup.exe`: installer

## Project layout

```
src/                     UI (plain HTML/CSS/JS, no bundler)
  index.html, app.js     full settings window
  flyout.*               tray quick panel
  overlay.html           the band drawn on each monitor
  paint.js, ring.css     colors and effects, shared by the overlay and the previews
  common.js, i18n.js     shared helpers and the UI strings (en, pt)
src-tauri/src/
  lib.rs                 state, commands, global shortcut and background task
  overlay.rs             one transparent window per monitor
  flyout.rs              tray panel window and its placement
  tray.rs                tray icon and menu
  win.rs                 Win32 tweaks: click-through, no focus, hidden from Alt+Tab, always on top
  camera.rs              webcam detection through the Windows registry
  settings.rs            settings and persistence
  i18n.rs                backend strings (tray, errors)
```

Settings live in `%APPDATA%\com.alexandre.ringlight\settings.json`.

## How it works

Each selected monitor gets a borderless, transparent window the size of the screen,
marked `WS_EX_TRANSPARENT | WS_EX_LAYERED` (clicks pass through), `WS_EX_NOACTIVATE`
(never takes focus) and `WS_EX_TOOLWINDOW` (hidden from Alt+Tab).

The band's shape (thickness, rounded corners and the soft inner edge) is an SVG mask
on that window, so anything painted underneath only shows through the band: a solid
color, a linear or conic CSS gradient, or one conic gradient split along the screen's
diagonals for per-side colors. Effects use the Web Animations API, mostly on composited
properties (transform, opacity, filter).

A background task runs every second. It keeps the overlays above other always-on-top
windows (such as the taskbar), keeps them in position across monitor changes, follows
the camera and saves the settings.
