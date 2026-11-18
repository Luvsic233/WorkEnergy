use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager, Wry};

use crate::desktop;

const ID_HIDE: &str = "bar-hide";
const ID_ALWAYS_ON_TOP: &str = "bar-always-on-top";
const ID_OVERTIME: &str = "bar-overtime";
const ID_SETTINGS: &str = "bar-settings";
const ID_QUIT: &str = "bar-quit";

/// 本地存储键：与前端 src/settings/storage.ts 的 STORAGE_KEY 必须一致。
const SETTINGS_KEY: &str = "workenergy.settings.v1";

/// 「加班模式」被点击后要在主窗口里跑的那一段 JS。
///
/// 它只做前端本来就会做的事：翻转 localStorage 里的 overtimeMode，然后广播既有的
/// settings-changed 事件 —— 悬浮条监听的就是这条事件，于是阶段文字与金额当场变化，
/// 跨窗口的同步机制一行都没另造。读不到的字段原样保留（只改 overtimeMode 一个键）。
fn overtime_toggle_script() -> String {
    format!(
        r#"(() => {{
  try {{
    const key = '{SETTINGS_KEY}';
    const raw = localStorage.getItem(key);
    let record = {{}};
    if (raw) {{
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed;
    }}
    record.overtimeMode = record.overtimeMode !== true;
    localStorage.setItem(key, JSON.stringify(record));
    if (window.__TAURI__ && window.__TAURI__.event) window.__TAURI__.event.emit('settings-changed');
  }} catch (error) {{
    /* 存储不可用时什么都不做：下一次打开菜单勾选状态会照旧由页面报告 */
  }}
}})()"#
    )
}

/// Native context menu popped up on the floating bar. It is a real Win32 menu
/// (muda), not a DOM element, and it is built once so the check items can be
/// kept in sync with the window state.
///
/// overtime_on 只是「上一次从页面读到的值」的影子：真相在 localStorage 里，
/// 每次弹出菜单都会拿到最新的那一份（见 show 的 overtime_mode 参数）。
pub struct BarMenu {
    menu: Menu<Wry>,
    always_on_top: CheckMenuItem<Wry>,
    overtime: CheckMenuItem<Wry>,
    overtime_on: AtomicBool,
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
    // 勾选状态在每次弹出菜单时由页面报上来（前端把 localStorage 里的值一起交给 show_bar_menu）。
    let overtime = CheckMenuItem::with_id(app, ID_OVERTIME, "加班模式", true, false, None::<&str>)?;
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
            &overtime,
            &separator_settings,
            &settings,
            &quit,
        ],
    )?;

    app.manage(BarMenu {
        menu,
        always_on_top,
        overtime,
        overtime_on: AtomicBool::new(false),
    });
    desktop::trace(&format!(
        "bar-menu: built ok (always_on_top={always_on_top_now}, items=5)"
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
///
/// overtime_mode 是页面在调用这一瞬间读到的 localStorage 值：勾选状态永远跟着页面走，
/// 不管上一次是菜单切的、设置面板切的还是手改存储的。
pub fn show(app: &AppHandle, overtime_mode: Option<bool>) -> tauri::Result<()> {
    let Some(window) = desktop::main_window(app) else {
        desktop::trace("bar-menu: popup skipped, main window missing");
        return Ok(());
    };
    let state = app.state::<BarMenu>();
    let current = window.is_always_on_top().unwrap_or(false);
    let _ = state.always_on_top.set_checked(current);
    let overtime_now = match overtime_mode {
        Some(value) => {
            state.overtime_on.store(value, Ordering::Relaxed);
            if let Err(error) = state.overtime.set_checked(value) {
                desktop::trace(&format!("bar-menu: overtime set_checked failed: {error}"));
            }
            value
        }
        None => state.overtime_on.load(Ordering::Relaxed),
    };
    desktop::trace(&format!(
        "bar-menu: popup requested from webview (overtime_mode={overtime_now})"
    ));
    let result = window.popup_menu(&state.menu);
    match &result {
        Ok(()) => desktop::trace(&format!(
            "bar-menu: popup returned ok (always_on_top={current}, overtime_mode={overtime_now})"
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

/// 「加班模式」：翻转页面里的开关并让它立刻生效，不进设置面板。
///
/// 顺序：先按影子状态推下一个值、更新勾选（菜单已经关了，勾选留给下一次打开也要对）；
/// 再把真正的翻转交给页面里的 JS —— 存储与重算只有前端一个真相。
fn toggle_overtime(app: &AppHandle) {
    let next = match app.try_state::<BarMenu>() {
        Some(state) => {
            let next = !state.overtime_on.load(Ordering::Relaxed);
            state.overtime_on.store(next, Ordering::Relaxed);
            if let Err(error) = state.overtime.set_checked(next) {
                desktop::trace(&format!("bar-menu: overtime set_checked failed: {error}"));
            }
            next
        }
        None => true,
    };
    let Some(window) = desktop::main_window(app) else {
        desktop::trace("bar-menu: overtime toggle skipped, main window missing");
        return;
    };
    match window.eval(&overtime_toggle_script()) {
        Ok(()) => desktop::trace(&format!("bar-menu: overtime toggled -> {next} (script queued)")),
        Err(error) => desktop::trace(&format!("bar-menu: overtime toggle eval failed: {error}")),
    }
}

/// Shared entry point for the popup handler and the `WE_DESKTOP_ACTION`
/// self-test hook, so both exercise exactly the same code path.
pub fn handle_id(app: &AppHandle, id: &str) {
    match id {
        ID_HIDE => desktop::hide_main_window(app),
        ID_ALWAYS_ON_TOP => desktop::toggle_always_on_top(app),
        ID_OVERTIME => toggle_overtime(app),
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
