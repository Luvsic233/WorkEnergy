#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop;
mod tray;

use tauri::Manager;

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
        .setup(|app| {
            let handle = app.handle();
            tray::install(handle)?;
            tray::run_startup_action(handle);
            desktop::log_window_position(handle, "startup");
            desktop::trace("setup: complete");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                desktop::log_window_position(window.app_handle(), "close-requested");
                desktop::trace("window: close requested");
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
