use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path};

pub const DEFAULT_COLOR: &str = "#ffefe1"; // 5600 K

const LANGUAGES: [&str; 3] = ["auto", "pt", "en"];
const COLOR_MODES: [&str; 4] = ["solid", "linear", "conic", "sides"];
const SHAPES: [&str; 4] = ["frame", "oval", "circle", "bars"];
const EFFECTS: [&str; 4] = ["none", "rotate", "pulse", "hue"];
const MAX_STOPS: usize = 5;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Side {
    pub on: bool,
    pub color: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Not read from disk: the light turns on when the app is opened manually
    /// and starts off when Windows launches it in the background at sign-in.
    #[serde(skip_deserializing)]
    pub enabled: bool,
    /// `"auto"` (follow Windows), `"pt"` or `"en"`.
    pub language: String,

    /// `"frame"` (band around every edge), `"oval"` (ring touching the
    /// edges), `"circle"` (round ring in the middle) or `"bars"` (left and
    /// right bars).
    pub shape: String,
    /// `"solid"`, `"linear"`, `"conic"` or `"sides"`.
    pub color_mode: String,
    /// Solid color as `#rrggbb`.
    pub color: String,
    /// Temperature that produced `color`; `None` for a custom color.
    pub kelvin: Option<u32>,
    /// 2–5 colors shared by the linear and conic gradients.
    pub gradient: Vec<String>,
    /// Linear gradient direction (CSS convention: 0° = bottom to top) or
    /// conic gradient start angle, in degrees.
    pub angle: u32,
    /// Top, right, bottom and left.
    pub sides: Vec<Side>,

    /// `"none"`, `"rotate"`, `"pulse"` or `"hue"`.
    pub effect: String,
    /// Effect speed, 1 (slow) to 10 (fast).
    pub speed: u32,

    /// Band opacity, 5–100 %. Lower values let the content behind show through.
    #[serde(alias = "brightness")]
    pub opacity: u32,
    /// Color intensity, 10–100 %. Dims the color while the band stays opaque.
    pub intensity: u32,
    /// Solid band thickness, px.
    pub thickness: u32,
    /// Width of the fade toward the center of the screen, px.
    pub softness: u32,
    /// Inner corner radius, px.
    pub radius: u32,

    /// `"primary"`, `"all"` or a monitor name (e.g. `\\.\DISPLAY1`).
    pub monitor: String,
    /// Keep the light inside the work area, so it never covers the taskbar.
    pub avoid_taskbar: bool,
    /// While the settings window is in use, slide the light under it so it
    /// doesn't cover the window. The window never floats over other programs.
    pub settings_on_top: bool,
    pub hide_from_capture: bool,
    pub auto_camera: bool,
    /// Global shortcut in global-hotkey syntax (e.g. `Ctrl+Alt+KeyL`); empty disables it.
    pub hotkey: String,
    pub autostart: bool,
}

fn default_gradient() -> Vec<String> {
    // 2700 K → 6500 K: warm at the bottom, cool at the top.
    vec!["#ffa757".into(), "#fffefa".into()]
}

fn default_sides() -> Vec<Side> {
    ["#ffefe1", "#fffefa", "#ffefe1", "#ffc18d"]
        .into_iter()
        .map(|c| Side { on: true, color: c.into() })
        .collect()
}

impl Default for Side {
    fn default() -> Self {
        Self { on: true, color: DEFAULT_COLOR.into() }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: true,
            language: "auto".into(),
            shape: "frame".into(),
            color_mode: "solid".into(),
            color: DEFAULT_COLOR.into(),
            kelvin: Some(5600),
            gradient: default_gradient(),
            angle: 0,
            sides: default_sides(),
            effect: "none".into(),
            speed: 4,
            opacity: 100,
            intensity: 100,
            thickness: 60,
            softness: 60,
            radius: 24,
            monitor: "primary".into(),
            avoid_taskbar: true,
            settings_on_top: true,
            hide_from_capture: true,
            auto_camera: false,
            hotkey: "Ctrl+Alt+KeyL".into(),
            autostart: false,
        }
    }
}

fn pick(value: &mut String, allowed: &[&str]) {
    if !allowed.contains(&value.as_str()) {
        *value = allowed[0].into();
    }
}

fn fix_color(value: &mut String) {
    *value = match parse_hex(value) {
        Some(_) => value.to_ascii_lowercase(),
        None => DEFAULT_COLOR.into(),
    };
}

impl Settings {
    pub fn sanitize(&mut self) {
        pick(&mut self.language, &LANGUAGES);
        pick(&mut self.shape, &SHAPES);
        pick(&mut self.color_mode, &COLOR_MODES);
        pick(&mut self.effect, &EFFECTS);

        fix_color(&mut self.color);
        self.kelvin = self.kelvin.map(|k| k.clamp(1500, 10000));
        if self.gradient.len() < 2 {
            self.gradient = default_gradient();
        }
        self.gradient.truncate(MAX_STOPS);
        self.gradient.iter_mut().for_each(fix_color);
        self.angle %= 360;
        if self.sides.len() != 4 {
            self.sides = default_sides();
        }
        self.sides.iter_mut().for_each(|s| fix_color(&mut s.color));

        self.speed = self.speed.clamp(1, 10);
        self.opacity = self.opacity.clamp(5, 100);
        self.intensity = self.intensity.clamp(10, 100);
        self.thickness = self.thickness.clamp(4, 1000);
        self.softness = self.softness.min(200);
        self.radius = self.radius.min(300);
        if self.monitor.is_empty() {
            self.monitor = "primary".into();
        }
    }
}

pub fn parse_hex(s: &str) -> Option<[u8; 3]> {
    let h = s.strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    Some([(v >> 16) as u8, (v >> 8) as u8, v as u8])
}

pub fn load(path: &Path) -> Settings {
    let mut s: Settings = fs::read_to_string(path)
        .ok()
        // Windows editors (and PowerShell 5) often write UTF-8 with a BOM.
        .and_then(|txt| serde_json::from_str(txt.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default();
    s.sanitize();
    s
}

pub fn save(path: &Path, s: &Settings) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(s).map_err(io::Error::other)?;
    // Write to a temp file and rename so a crash never leaves a truncated config.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(tmp, path)
}
