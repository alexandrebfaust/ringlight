//! Win32 tweaks for the overlay windows that Tauri doesn't expose.

use tauri::WebviewWindow;

#[cfg(windows)]
mod imp {
    use super::WebviewWindow;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    fn hwnd(w: &WebviewWindow) -> Option<HWND> {
        w.hwnd().ok().map(|h| h.0 as HWND)
    }

    fn set_topmost(h: HWND) {
        unsafe {
            SetWindowPos(
                h,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            );
        }
    }

    /// Makes the overlay click-through, never focused and hidden from Alt+Tab,
    /// and moves it above other always-on-top windows. tao rewrites
    /// GWL_EXSTYLE whenever its own flags change, so this is reapplied
    /// periodically. Runs on the main thread, which owns the overlays, so the
    /// z-order change is synchronous and callers can stack windows above it.
    pub fn enforce(w: &WebviewWindow) {
        let Some(h) = hwnd(w) else { return };
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            let want = (ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED)
                & !WS_EX_APPWINDOW;
            if want != ex {
                SetWindowLongPtrW(h, GWL_EXSTYLE, want as isize);
            }
        }
        set_topmost(h);
    }

    /// Puts a window at the very top of the always-on-top band.
    pub fn raise(w: &WebviewWindow) {
        if let Some(h) = hwnd(w) {
            set_topmost(h);
        }
    }

    pub fn show(w: &WebviewWindow) {
        enforce(w);
        if let Some(h) = hwnd(w) {
            unsafe {
                if IsWindowVisible(h) == 0 {
                    ShowWindowAsync(h, SW_SHOWNOACTIVATE);
                }
            }
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
    pub fn raise(w: &WebviewWindow) {
        let _ = w.set_always_on_top(true);
    }
    pub fn show(w: &WebviewWindow) {
        enforce(w);
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
