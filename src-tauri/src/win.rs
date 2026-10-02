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

    fn set_topmost(h: HWND, flags: SET_WINDOW_POS_FLAGS) {
        unsafe {
            SetWindowPos(
                h,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | flags,
            );
        }
    }

    /// Makes the overlay click-through, never focused and hidden from Alt+Tab.
    /// With `raise`, also moves it above other always-on-top windows. tao
    /// rewrites GWL_EXSTYLE whenever its own flags change, so this is
    /// reapplied periodically.
    pub fn enforce(w: &WebviewWindow, raise: bool) {
        let Some(h) = hwnd(w) else { return };
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            let want = (ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED)
                & !WS_EX_APPWINDOW;
            if want != ex {
                SetWindowLongPtrW(h, GWL_EXSTYLE, want as isize);
            }
        }
        if raise {
            set_topmost(h, SWP_ASYNCWINDOWPOS);
        }
    }

    /// Puts a window at the very top of the always-on-top band.
    pub fn raise(w: &WebviewWindow) {
        if let Some(h) = hwnd(w) {
            set_topmost(h, 0);
        }
    }

    pub fn show(w: &WebviewWindow, raise: bool) {
        enforce(w, raise);
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

    pub fn enforce(w: &WebviewWindow, raise: bool) {
        if raise {
            let _ = w.set_always_on_top(true);
        }
    }
    pub fn raise(w: &WebviewWindow) {
        let _ = w.set_always_on_top(true);
    }
    pub fn show(w: &WebviewWindow, raise: bool) {
        enforce(w, raise);
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
