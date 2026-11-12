use std::io::Write;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Label of the floating bar window declared in `tauri.conf.json`.
pub const MAIN_WINDOW: &str = "main";
/// Label of the on-demand settings window (430x540, real title bar).
pub const SETTINGS_WINDOW: &str = "settings";

/// Diagnostics are written to a file by default so a field bug leaves evidence:
/// %LOCALAPPDATA%/com.workenergy.shell/desktop.log . WE_DESKTOP_LOG still overrides
/// the path. The file is dropped once it grows past the cap, so it cannot eat a disk.
const LOG_ENV: &str = "WE_DESKTOP_LOG";
const LOG_MAX_BYTES: u64 = 256 * 1024;

fn default_log_path() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let mut path = std::path::PathBuf::from(base);
    path.push("com.workenergy.shell");
    let _ = std::fs::create_dir_all(&path);
    path.push("desktop.log");
    Some(path)
}

pub fn trace(message: &str) {
    let target = std::env::var_os(LOG_ENV)
        .map(std::path::PathBuf::from)
        .or_else(default_log_path);
    let Some(path) = target else {
        return;
    };
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_MAX_BYTES {
            let _ = std::fs::remove_file(&path);
        }
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW)
}

pub fn log_window_position(app: &AppHandle, stage: &str) {
    let Some(window) = main_window(app) else {
        trace(&format!("window: {stage}: main window missing"));
        return;
    };
    match window.outer_position() {
        Ok(position) => trace(&format!(
            "window: {stage}: position {},{}",
            position.x, position.y
        )),
        Err(error) => trace(&format!("window: {stage}: position error {error}")),
    }
}

pub fn show_main_window(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    trace("window: shown and focused");
}

pub fn hide_main_window(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    match window.hide() {
        Ok(()) => trace("window: hidden from bar"),
        Err(error) => trace(&format!("window: hide failed: {error}")),
    }
}

pub fn toggle_main_window(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if visible && !minimized {
        let _ = window.hide();
        trace("window: hidden from tray");
    } else {
        show_main_window(app);
    }
}

/// One settings window for the whole process: a second request focuses the
/// existing one instead of stacking another window on top of it.
pub fn open_settings_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        trace("settings: reused existing window (shown and focused)");
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        SETTINGS_WINDOW,
        WebviewUrl::App("index.html#/settings".into()),
    )
    .title("Work Energy · 设置")
    .inner_size(430.0, 540.0)
    .resizable(true)
    .decorations(true)
    .transparent(false)
    .always_on_top(false)
    .center()
    .build()?;
    let _ = window.set_focus();
    trace(&format!(
        "settings: created window {}x{} decorations={} (label={SETTINGS_WINDOW})",
        window.inner_size().map(|size| size.width).unwrap_or(0),
        window.inner_size().map(|size| size.height).unwrap_or(0),
        window.is_decorated().unwrap_or(false),
    ));
    Ok(())
}

pub fn hide_settings_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(SETTINGS_WINDOW) else {
        return;
    };
    match window.hide() {
        Ok(()) => trace("settings: hidden"),
        Err(error) => trace(&format!("settings: hide failed: {error}")),
    }
}

/// Runs a script inside the floating bar webview. Only used by the
/// `WE_DESKTOP_ACTION` self-test hook to exercise the real JS -> IPC path.
pub fn eval_self_test(app: &AppHandle, script: &str) {
    let Some(window) = main_window(app) else {
        trace("self-test: eval skipped, main window missing");
        return;
    };
    match window.eval(script) {
        Ok(()) => trace(&format!("self-test: eval queued: {script}")),
        Err(error) => trace(&format!("self-test: eval failed: {error}")),
    }
}

/// `WS_EX_TOPMOST` 的 z 序锚点：tao 在运行期修改扩展样式这条路在本机不稳定
/// （实测同一次调用有时生效、有时不生效），所以窗口层真置顶由 Win32 `SetWindowPos` 兜底。
#[cfg(windows)]
fn pin_z_order(window: &WebviewWindow, topmost: bool) -> bool {
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hwnd: *mut std::ffi::c_void,
            insert_after: *mut std::ffi::c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }

    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    let insert_after = if topmost { -1isize } else { -2isize } as *mut std::ffi::c_void;
    let ok = unsafe {
        SetWindowPos(
            hwnd.0 as *mut std::ffi::c_void,
            insert_after,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    } != 0;
    ok
}

#[cfg(not(windows))]
fn pin_z_order(_window: &WebviewWindow, _topmost: bool) -> bool {
    false
}

/// Toggles the floating bar topmost state and keeps both the tray check item
/// and the right-click menu check item in sync with the real window state.
pub fn toggle_always_on_top(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        trace("always-on-top: main window missing");
        return;
    };
    let current = window.is_always_on_top().unwrap_or(false);
    let next = !current;

    let applied = window.set_always_on_top(next);
    let pinned = pin_z_order(&window, next);

    // tao 的扩展样式写入是排队执行的，可能在我们的 SetWindowPos 之后才落地，
    // 所以再延迟复钉一次，保证「勾上就真的在最前」。
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(250));
        if let Some(window) = main_window(&handle) {
            let again = pin_z_order(&window, next);
            trace(&format!("always-on-top: re-pin after 250ms = {again}"));
        }
    });

    if let Err(error) = applied {
        trace(&format!("always-on-top: setter failed: {error}"));
    }
    crate::tray::sync_always_on_top(app, next);
    crate::bar_menu::sync_always_on_top(app, next);
    trace(&format!(
        "always-on-top: {current} -> {next} (z-order pinned={pinned})"
    ));
}
