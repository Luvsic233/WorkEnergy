use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager, Wry};

use crate::desktop;

const ID_HIDE: &str = "bar-hide";
const ID_ALWAYS_ON_TOP: &str = "bar-always-on-top";
const ID_SETTINGS: &str = "bar-settings";
const ID_QUIT: &str = "bar-quit";

/// Native context menu popped up on the floating bar. It is a real Win32 menu
/// (muda), not a DOM element, and it is built once so the check item can be
/// kept in sync with the window state.
pub struct BarMenu {
    menu: Menu<Wry>,
    always_on_top: CheckMenuItem<Wry>,
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let always_on_top_now = desktop::main_window(app)
        .and_then(|window| window.is_always_on_top().ok())
        .unwrap_or(false);

    let hide = MenuItem::with_id(app, ID_HIDE, "隐藏到托盘", true, None::<&str>)?;
    let always_on_top = CheckMenuItem::with_id(
        app,
        ID_ALWAYS_ON_TOP,
        "总在最前",
        true,
        always_on_top_now,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, ID_SETTINGS, "设置…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "退出", true, None::<&str>)?;
    let separator_hide = PredefinedMenuItem::separator(app)?;
    let separator_settings = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &hide,
            &separator_hide,
            &always_on_top,
            &separator_settings,
            &settings,
            &quit,
        ],
    )?;

    app.manage(BarMenu {
        menu,
        always_on_top,
    });
    desktop::trace(&format!(
        "bar-menu: built ok (always_on_top={always_on_top_now}, items=4)"
    ));
    Ok(())
}

pub fn sync_always_on_top(app: &AppHandle, value: bool) {
    if let Some(state) = app.try_state::<BarMenu>() {
        if let Err(error) = state.always_on_top.set_checked(value) {
            desktop::trace(&format!("bar-menu: set_checked failed: {error}"));
        }
    }
}

/// Pops the menu at the cursor. Called from the webview contextmenu handler.
pub fn show(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = desktop::main_window(app) else {
        desktop::trace("bar-menu: popup skipped, main window missing");
        return Ok(());
    };
    let state = app.state::<BarMenu>();
    let current = window.is_always_on_top().unwrap_or(false);
    let _ = state.always_on_top.set_checked(current);
    desktop::trace("bar-menu: popup requested from webview");
    let result = window.popup_menu(&state.menu);
    match &result {
        Ok(()) => desktop::trace(&format!(
            "bar-menu: popup returned ok (always_on_top={current})"
        )),
        Err(error) => desktop::trace(&format!("bar-menu: popup failed: {error}")),
    }
    result
}

pub fn is_bar_id(id: &str) -> bool {
    id.starts_with("bar-")
}

pub fn handle_menu_event(app: &AppHandle, event: &MenuEvent) {
    handle_id(app, event.id().as_ref());
}

/// Shared entry point for the popup handler and the `WE_DESKTOP_ACTION`
/// self-test hook, so both exercise exactly the same code path.
pub fn handle_id(app: &AppHandle, id: &str) {
    match id {
        ID_HIDE => desktop::hide_main_window(app),
        ID_ALWAYS_ON_TOP => desktop::toggle_always_on_top(app),
        ID_SETTINGS => match desktop::open_settings_window(app) {
            Ok(()) => desktop::trace("bar-menu: settings requested"),
            Err(error) => desktop::trace(&format!("bar-menu: settings failed: {error}")),
        },
        ID_QUIT => {
            desktop::trace("bar-menu: quit requested");
            app.exit(0);
        }
        other => desktop::trace(&format!("bar-menu: unhandled menu id {other}")),
    }
}
