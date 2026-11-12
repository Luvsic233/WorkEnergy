#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bar_menu;
mod celebration;
mod desktop;
mod tray;

use tauri::{AppHandle, Manager};

/// Hover close button on the floating bar: hides the bar, the tray keeps it
/// reachable. Never exits the process.
#[tauri::command]
fn hide_main(app: AppHandle) {
    desktop::hide_main_window(&app);
}

/// Hides the settings window (its close button / title bar X keeps it alive, so
/// the next "设置…" click just brings it back).
#[tauri::command]
fn hide_settings(app: AppHandle) {
    desktop::hide_settings_window(&app);
}

/// Pops the native context menu at the cursor position. Async on purpose: the
/// menu is modal on the main thread and must not block the IPC handler.
#[tauri::command]
async fn show_bar_menu(app: AppHandle) -> Result<(), String> {
    bar_menu::show(&app).map_err(|error| error.to_string())
}

/// 跨过一个 20 元整数倍时弹一次庆祝窗（label=celebrate，200x200，不抢焦点）。
/// 主卡已隐藏到托盘时什么都不做 —— 位置只能相对主卡算，看不见主卡就不该弹。
#[tauri::command]
fn show_celebration(app: AppHandle) {
    celebration::show(&app);
}

/// 庆祝弹窗的露出时长（4 秒）到点由前端调：只隐藏，不销毁，下次复用同一个 webview。
#[tauri::command]
fn hide_celebration(app: AppHandle) {
    celebration::hide(&app);
}

fn main() {
    tauri::Builder::default()
        // Single instance must be the first plugin so a second launch bails out
        // before any window or tray icon is created.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            desktop::trace("single-instance: second launch detected");
            desktop::show_main_window(app);
        }))
        // 用户主题目录（%APPDATA%\com.workenergy.shell\themes）的读写走 fs 插件：
        // 前端调的是 plugin:fs|read_dir / read_text_file / write_text_file / mkdir，
        // 没有这个插件就是空转。scope 由 capabilities/default.json 收窄到 themes/**。
        .plugin(tauri_plugin_fs::init())
        // 「打开主题文件夹」按钮走 plugin:opener|open_path。
        .plugin(tauri_plugin_opener::init())
        // Only the window position is remembered; the shell keeps a fixed size.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        // Registered but never enabled by us: autostart stays off until the user
        // turns it on from the tray menu.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            hide_main,
            hide_settings,
            show_bar_menu,
            show_celebration,
            hide_celebration
        ])
        .setup(|app| {
            let handle = app.handle();
            tray::install(handle)?;
            bar_menu::install(handle)?;
            tray::run_startup_action(handle);
            celebration::run_startup_hook(handle);
            desktop::log_window_position(handle, "startup");
            desktop::trace("setup: complete");
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            if bar_menu::is_bar_id(&id) {
                bar_menu::handle_menu_event(app, &event);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == desktop::SETTINGS_WINDOW {
                    // Keep the settings window alive: hiding it preserves the
                    // draft and makes "设置…" reuse instead of recreate.
                    api.prevent_close();
                    let _ = window.hide();
                    desktop::trace("settings: close requested -> hidden");
                    return;
                }
                desktop::log_window_position(window.app_handle(), "close-requested");
                desktop::trace("window: close requested");
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
