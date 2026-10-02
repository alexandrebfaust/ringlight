//! Ajustes Win32 que o Tauri não expõe para as janelas de sobreposição.

use tauri::WebviewWindow;

#[cfg(windows)]
mod imp {
    use super::WebviewWindow;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    fn hwnd(w: &WebviewWindow) -> Option<HWND> {
        w.hwnd().ok().map(|h| h.0 as HWND)
    }

    /// Garante que a sobreposição deixe os cliques passarem, não receba foco,
    /// não apareça no Alt+Tab e fique acima das outras janelas "sempre no topo".
    /// O tao reescreve GWL_EXSTYLE quando muda os próprios flags, então isto é
    /// reaplicado periodicamente.
    pub fn enforce(w: &WebviewWindow) {
        let Some(h) = hwnd(w) else { return };
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            let want = (ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED)
                & !WS_EX_APPWINDOW;
            if want != ex {
                SetWindowLongPtrW(h, GWL_EXSTYLE, want as isize);
            }
            SetWindowPos(
                h,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS,
            );
        }
    }

    pub fn show(w: &WebviewWindow) {
        enforce(w);
        if let Some(h) = hwnd(w) {
            unsafe { ShowWindowAsync(h, SW_SHOWNOACTIVATE) };
        }
    }

    pub fn hide(w: &WebviewWindow) {
        if let Some(h) = hwnd(w) {
            unsafe { ShowWindowAsync(h, SW_HIDE) };
        }
    }

    pub fn is_visible(w: &WebviewWindow) -> bool {
        hwnd(w).is_some_and(|h| unsafe { IsWindowVisible(h) != 0 })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::WebviewWindow;

    pub fn enforce(w: &WebviewWindow) {
        let _ = w.set_always_on_top(true);
    }
    pub fn show(w: &WebviewWindow) {
        let _ = w.show();
    }
    pub fn hide(w: &WebviewWindow) {
        let _ = w.hide();
    }
    pub fn is_visible(w: &WebviewWindow) -> bool {
        w.is_visible().unwrap_or(false)
    }
}

pub use imp::*;
