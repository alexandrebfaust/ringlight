//! Win32 tweaks for the overlay windows that Tauri doesn't expose.
//!
//! Everything that touches the z-order runs on the main thread, which owns the
//! windows, so the calls are synchronous and their order is the final order.

use tauri::WebviewWindow;

#[cfg(windows)]
mod imp {
    use super::WebviewWindow;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    const KEEP: SET_WINDOW_POS_FLAGS = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER;

    fn hwnd(w: &WebviewWindow) -> Option<HWND> {
        w.hwnd().ok().map(|h| h.0 as HWND)
    }

    fn insert_after(h: HWND, after: HWND) {
        unsafe { SetWindowPos(h, after, 0, 0, 0, 0, KEEP) };
    }

    /// Click-through, never focused and hidden from Alt+Tab. tao rewrites
    /// GWL_EXSTYLE whenever its own flags change, so this is reapplied
    /// periodically.
    fn fix_styles(h: HWND) {
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            let want = (ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED)
                & !WS_EX_APPWINDOW;
            if want != ex {
                SetWindowLongPtrW(h, GWL_EXSTYLE, want as isize);
            }
        }
    }

    /// Overlay styles, at the top of the always-on-top band.
    pub fn enforce(w: &WebviewWindow) {
        if let Some(h) = hwnd(w) {
            fix_styles(h);
            insert_after(h, HWND_TOPMOST);
        }
    }

    /// Shows an overlay above every other window, or, with `below`, right
    /// under that window: out of the always-on-top band, but still above all
    /// the other regular windows.
    pub fn show(w: &WebviewWindow, below: Option<&WebviewWindow>) {
        let Some(h) = hwnd(w) else { return };
        fix_styles(h);
        match below.and_then(hwnd) {
            Some(top) => {
                // Leave the always-on-top band first; a topmost window can't
                // be stacked under a regular one.
                insert_after(h, HWND_NOTOPMOST);
                insert_after(h, top);
            }
            None => insert_after(h, HWND_TOPMOST),
        }
        unsafe {
            if IsWindowVisible(h) == 0 {
                ShowWindow(h, SW_SHOWNOACTIVATE);
            }
        }
    }

    /// Puts a window at the very top of the always-on-top band.
    pub fn raise(w: &WebviewWindow) {
        if let Some(h) = hwnd(w) {
            insert_after(h, HWND_TOPMOST);
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

    /// Whether the window is the one the user is currently working in.
    pub fn is_foreground(w: &WebviewWindow) -> bool {
        hwnd(w).is_some_and(|h| unsafe { GetForegroundWindow() == h })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::WebviewWindow;

    pub fn enforce(w: &WebviewWindow) {
        let _ = w.set_always_on_top(true);
    }
    pub fn show(w: &WebviewWindow, below: Option<&WebviewWindow>) {
        let _ = w.set_always_on_top(below.is_none());
        let _ = w.show();
    }
    pub fn raise(w: &WebviewWindow) {
        let _ = w.set_always_on_top(true);
    }
    pub fn hide(w: &WebviewWindow) {
        let _ = w.hide();
    }
    pub fn is_visible(w: &WebviewWindow) -> bool {
        w.is_visible().unwrap_or(false)
    }
    pub fn is_foreground(w: &WebviewWindow) -> bool {
        w.is_focused().unwrap_or(false)
    }
}

pub use imp::*;
