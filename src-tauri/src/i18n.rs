//! Backend strings (tray menu, tooltips, errors). The settings window has its
//! own dictionary in `src/i18n.js`.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    Pt,
    En,
}

pub struct Text {
    pub tray_toggle: &'static str,
    pub tray_settings: &'static str,
    pub tray_quit: &'static str,
    pub tooltip_on: &'static str,
    pub tooltip_off: &'static str,
    /// `{}` is replaced by the shortcut.
    pub hotkey_invalid: &'static str,
    pub hotkey_in_use: &'static str,
    /// `{}` is replaced by the system error.
    pub autostart_failed: &'static str,
}

const PT: Text = Text {
    tray_toggle: "Ringlight ligada",
    tray_settings: "Configurações…",
    tray_quit: "Sair",
    tooltip_on: "Ringlight — ligada",
    tooltip_off: "Ringlight — desligada",
    hotkey_invalid: "\"{}\" não é um atalho válido.",
    hotkey_in_use: "Esse atalho já está em uso por outro programa. Escolha outra combinação.",
    autostart_failed: "Não foi possível alterar a inicialização com o Windows: {}",
};

const EN: Text = Text {
    tray_toggle: "Ring light on",
    tray_settings: "Settings…",
    tray_quit: "Quit",
    tooltip_on: "Ringlight — on",
    tooltip_off: "Ringlight — off",
    hotkey_invalid: "\"{}\" is not a valid shortcut.",
    hotkey_in_use: "That shortcut is already used by another program. Pick a different combination.",
    autostart_failed: "Couldn't change start with Windows: {}",
};

impl Lang {
    pub fn code(self) -> &'static str {
        match self {
            Lang::Pt => "pt",
            Lang::En => "en",
        }
    }

    pub fn text(self) -> &'static Text {
        match self {
            Lang::Pt => &PT,
            Lang::En => &EN,
        }
    }
}

/// Portuguese for any `pt-*` Windows display language, English otherwise.
pub fn system() -> Lang {
    match sys_locale::get_locale() {
        Some(l) if l.to_ascii_lowercase().starts_with("pt") => Lang::Pt,
        _ => Lang::En,
    }
}

/// Resolves the `language` setting (`"auto"`, `"pt"` or `"en"`).
pub fn resolve(setting: &str) -> Lang {
    match setting {
        "pt" => Lang::Pt,
        "en" => Lang::En,
        _ => system(),
    }
}
