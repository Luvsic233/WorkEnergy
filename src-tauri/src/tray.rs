use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt as AutostartExt;

use crate::desktop;

const TRAY_ID: &str = "main-tray";
const ID_SHOW_HIDE: &str = "show-hide";
const ID_ALWAYS_ON_TOP: &str = "always-on-top";
const ID_AUTOSTART: &str = "autostart";
const ID_QUIT: &str = "quit";

/// Check items handed to the event handler so toggles stay in sync with the
/// menu without rebuilding it.
struct TrayMenu {
    always_on_top: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let always_on_top_now = desktop::main_window(app)
        .and_then(|window| window.is_always_on_top().ok())
        .unwrap_or(true);
    let autostart_now = app.autolaunch().is_enabled().unwrap_or(false);

    let show_hide = MenuItem::with_id(app, ID_SHOW_HIDE, "显示 / 隐藏窗口", true, None::<&str>)?;
    let always_on_top = CheckMenuItem::with_id(
        app,
        ID_ALWAYS_ON_TOP,
        "窗口置顶",
        true,
        always_on_top_now,
        None::<&str>,
    )?;
    let autostart = CheckMenuItem::with_id(
        app,
        ID_AUTOSTART,
        "开机自启（当前用户）",
        true,
        autostart_now,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, ID_QUIT, "退出", true, None::<&str>)?;
    let separator_top = PredefinedMenuItem::separator(app)?;
    let separator_mid = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_hide,
            &always_on_top,
            &separator_top,
            &autostart,
            &separator_mid,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .tooltip("Work Energy")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, event))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                desktop::toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayMenu {
        always_on_top,
        autostart,
    });
    desktop::trace(&format!(
        "tray: created ok (always_on_top={always_on_top_now}, autostart={autostart_now})"
    ));
    Ok(())
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    handle_menu_id(app, event.id().as_ref());
}

/// Automated-check hook: exercises the very same handlers the tray menu calls,
/// without a mouse. Only runs when `WE_DESKTOP_ACTION` is set; normal launches
/// are unaffected.
pub fn run_startup_action(app: &AppHandle) {
    let Ok(action) = std::env::var("WE_DESKTOP_ACTION") else {
        return;
    };
    desktop::trace(&format!("self-test: action {action}"));
    match action.as_str() {
        "show-hide" => handle_menu_id(app, ID_SHOW_HIDE),
        "always-on-top" => handle_menu_id(app, ID_ALWAYS_ON_TOP),
        "autostart" => handle_menu_id(app, ID_AUTOSTART),
        "quit" => handle_menu_id(app, ID_QUIT),
        other => desktop::trace(&format!("self-test: unknown action {other}")),
    }
}

fn handle_menu_id(app: &AppHandle, id: &str) {
    match id {
        ID_SHOW_HIDE => desktop::toggle_main_window(app),
        ID_ALWAYS_ON_TOP => toggle_always_on_top(app),
        ID_AUTOSTART => toggle_autostart(app),
        ID_QUIT => {
            desktop::trace("tray: quit requested");
            app.exit(0);
        }
        other => desktop::trace(&format!("tray: unhandled menu id {other}")),
    }
}

fn toggle_always_on_top(app: &AppHandle) {
    let Some(window) = desktop::main_window(app) else {
        return;
    };
    let current = window.is_always_on_top().unwrap_or(true);
    let next = !current;
    match window.set_always_on_top(next) {
        Ok(()) => {
            let _ = app.state::<TrayMenu>().always_on_top.set_checked(next);
            desktop::trace(&format!("tray: always-on-top {current} -> {next}"));
        }
        Err(error) => desktop::trace(&format!("tray: always-on-top failed: {error}")),
    }
}

fn toggle_autostart(app: &AppHandle) {
    let autolaunch = app.autolaunch();
    let current = autolaunch.is_enabled().unwrap_or(false);
    let result = if current {
        autolaunch.disable()
    } else {
        autolaunch.enable()
    };
    let now = autolaunch.is_enabled().unwrap_or(false);
    let _ = app.state::<TrayMenu>().autostart.set_checked(now);
    desktop::trace(&format!(
        "tray: autostart {current} -> {now} (ok={}, error={:?})",
        result.is_ok(),
        result.err().map(|error| error.to_string())
    ));
}
