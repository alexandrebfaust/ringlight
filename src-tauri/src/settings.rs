use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path};

pub const DEFAULT_COLOR: &str = "#ffefe1"; // 5600 K

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Não é lido do disco: a luz acende ao abrir o app manualmente e começa
    /// apagada quando o Windows inicia o app em segundo plano.
    #[serde(skip_deserializing)]
    pub enabled: bool,
    /// Cor final da luz em `#rrggbb`.
    pub color: String,
    /// Temperatura que gerou `color`; `None` quando a cor é personalizada.
    pub kelvin: Option<u32>,
    /// Opacidade da faixa, 5–100 %.
    pub brightness: u32,
    /// Espessura da faixa sólida, em px.
    pub thickness: u32,
    /// Largura do degradê que avança para dentro da tela, em px.
    pub softness: u32,
    /// Raio dos cantos internos, em px.
    pub radius: u32,
    /// `"primary"`, `"all"` ou o nome do monitor (ex.: `\\.\DISPLAY1`).
    pub monitor: String,
    pub hide_from_capture: bool,
    pub auto_camera: bool,
    /// Atalho global no formato do global-hotkey (ex.: `Ctrl+Alt+KeyL`); vazio desativa.
    pub hotkey: String,
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: true,
            color: DEFAULT_COLOR.into(),
            kelvin: Some(5600),
            brightness: 100,
            thickness: 60,
            softness: 60,
            radius: 24,
            monitor: "primary".into(),
            hide_from_capture: true,
            auto_camera: false,
            hotkey: "Ctrl+Alt+KeyL".into(),
            autostart: false,
        }
    }
}

impl Settings {
    pub fn sanitize(&mut self) {
        self.brightness = self.brightness.clamp(5, 100);
        self.thickness = self.thickness.clamp(4, 300);
        self.softness = self.softness.min(200);
        self.radius = self.radius.min(300);
        self.kelvin = self.kelvin.map(|k| k.clamp(1500, 10000));
        if parse_hex(&self.color).is_none() {
            self.color = DEFAULT_COLOR.into();
        }
        if self.monitor.is_empty() {
            self.monitor = "primary".into();
        }
    }

    pub fn rgb(&self) -> [u8; 3] {
        parse_hex(&self.color).unwrap_or([255, 255, 255])
    }
}

fn parse_hex(s: &str) -> Option<[u8; 3]> {
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
        // Editores do Windows (e o PowerShell 5) costumam gravar UTF-8 com BOM.
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
    // Grava num arquivo temporário e renomeia para não corromper a configuração.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(tmp, path)
}
