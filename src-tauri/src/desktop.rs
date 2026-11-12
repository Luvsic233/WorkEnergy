use std::io::Write;

use tauri::{AppHandle, Manager, WebviewWindow};

/// Label of the single window declared in `tauri.conf.json`.
pub const MAIN_WINDOW: &str = "main";

/// Diagnostics are opt-in: set this env var to a file path and every desktop
/// event (tray creation, menu toggles, single-instance handoff, saved window
/// position) is appended there. Nothing is written otherwise.
const LOG_ENV: &str = "WE_DESKTOP_LOG";

pub fn trace(message: &str) {
    let Ok(path) = std::env::var(LOG_ENV) else {
        return;
    };
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
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
