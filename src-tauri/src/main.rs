#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bar_menu;
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

fn main() {
    tauri::Builder::default()
        // Single instance must be the first plugin so a second launch bails out
        // before any window or tray icon is created.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            desktop::trace("single-instance: second launch detected");
            desktop::show_main_window(app);
        }))
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
        .invoke_handler(tauri::generate_handler![hide_main, hide_settings, show_bar_menu])
        .setup(|app| {
            let handle = app.handle();
            tray::install(handle)?;
            bar_menu::install(handle)?;
            tray::run_startup_action(handle);
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
