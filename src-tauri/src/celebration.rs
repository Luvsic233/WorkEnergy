use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::desktop;

/// Label of the celebration popup (created on demand, hidden instead of destroyed).
pub const CELEBRATION_WINDOW: &str = "celebrate";

/// 逻辑像素：弹窗是 200x200，与主卡（耄耋猫 340x96）无关。
const CELEBRATION_SIZE: f64 = 200.0;
/// 弹窗底边与主卡顶边之间的逻辑间距。
const CELEBRATION_GAP: f64 = 8.0;
/// 露出时长（毫秒）：与前端 src/theme/celebration.ts 的 CELEBRATION_VISIBLE_MS 同一个口径，
/// 前端到点自己调 hide_celebration；这里只做兜底，所以多加一点宽限。
const CELEBRATION_VISIBLE_MS: u64 = 4_000;
/// 兜底宽限：页面正常会在 4 秒后自己收；这条只防止页面没加载起来时留下永远置顶的小窗。
const WATCHDOG_GRACE_MS: u64 = 1_200;
/// 每次 show 后打进页面的一行脚本：让页面把露出计时重新数一遍。
const PING_SCRIPT: &str = "if (window.__WE_CELEBRATE_PING__) { window.__WE_CELEBRATE_PING__(); }";
/// 自动化验收开关（真机验证用）：celebrate / celebrate-twice / celebrate-hidden。
const TEST_ENV: &str = "WE_DESKTOP_TEST";

/// 日志时间戳（epoch 毫秒）：验收时要能把"露出多久"算到数字上，不靠肉眼估。
fn stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

/// 每次 show 递增：旧的那次 show 留下的兜底计时到点后发现代号变了就不动手，
/// 于是"露出期间再触发一次"= 重新计时，而不是在第 4 秒被上一发收掉。
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug)]
pub struct Extent {
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    /// true = 上方放不下，改放主卡下方。
    pub below: bool,
}

/// 纯位置计算（物理像素）：水平与主卡居中对齐，底边贴主卡顶边上方 gap；
/// 上方越界（y 小于顶部边界）就改放主卡下方。
pub fn placement(
    main_position: (i32, i32),
    main_size: Extent,
    popup: Extent,
    gap: i32,
    top_limit: i32,
) -> Placement {
    let x = main_position.0 + (main_size.width - popup.width) / 2;
    let above = main_position.1 - popup.height - gap;
    if above >= top_limit {
        Placement { x, y: above, below: false }
    } else {
        Placement {
            x,
            y: main_position.1 + main_size.height + gap,
            below: true,
        }
    }
}

/// 一个进程只有一个庆祝窗口：存在就复用（已隐藏的再 show 一次），不存在才创建。
fn ensure_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(CELEBRATION_WINDOW) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(
        app,
        CELEBRATION_WINDOW,
        WebviewUrl::App("index.html#/celebrate".into()),
    )
    .title("Work Energy · 庆祝")
    .inner_size(CELEBRATION_SIZE, CELEBRATION_SIZE)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .focused(false)
    // 先建后显：位置算好之前不显示，避免在 (0,0) 闪一帧。
    .visible(false)
    .build()?;
    desktop::trace("celebrate: window created (hidden until placed)");
    Ok(window)
}

pub fn show(app: &AppHandle) {
    let Some(main) = desktop::main_window(app) else {
        desktop::trace("celebrate: main window missing -> skipped");
        return;
    };
    let visible = main.is_visible().unwrap_or(false);
    let minimized = main.is_minimized().unwrap_or(false);
    if !visible || minimized {
        desktop::trace(&format!(
            "celebrate: skipped (main visible={visible} minimized={minimized})"
        ));
        return;
    }

    let window = match ensure_window(app) {
        Ok(window) => window,
        Err(error) => {
            desktop::trace(&format!("celebrate: create failed: {error}"));
            return;
        }
    };

    let (Ok(main_position), Ok(main_size), Ok(popup_size), Ok(scale)) = (
        main.outer_position(),
        main.outer_size(),
        window.outer_size(),
        main.scale_factor(),
    ) else {
        desktop::trace("celebrate: geometry unavailable -> skipped");
        return;
    };

    // DPI：outer_position / outer_size 都是物理像素，逻辑间距要自己乘缩放系数。
    let gap = (CELEBRATION_GAP * scale).round() as i32;
    let top_limit = main
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.position().y)
        .unwrap_or(0);
    let placed = placement(
        (main_position.x, main_position.y),
        Extent {
            width: main_size.width as i32,
            height: main_size.height as i32,
        },
        Extent {
            width: popup_size.width as i32,
            height: popup_size.height as i32,
        },
        gap,
        top_limit,
    );

    if let Err(error) = window.set_position(PhysicalPosition::new(placed.x, placed.y)) {
        desktop::trace(&format!("celebrate: set_position failed: {error}"));
    }
    if let Err(error) = window.show() {
        desktop::trace(&format!("celebrate: show failed: {error}"));
    }
    // 露出期间再触发一次：页面把 4 秒重新数一遍（窗口不重建、也不提前收）。
    if let Err(error) = window.eval(PING_SCRIPT) {
        desktop::trace(&format!("celebrate: ping failed: {error}"));
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    desktop::trace(&format!(
        "celebrate[{}]: shown at {},{} (below={}, generation={}) main={}x{}@ {},{} popup={}x{} scale={scale} gap={gap} top_limit={top_limit}",
        stamp(),
        placed.x,
        placed.y,
        placed.below,
        generation,
        main_size.width,
        main_size.height,
        main_position.x,
        main_position.y,
        popup_size.width,
        popup_size.height,
    ));

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(CELEBRATION_VISIBLE_MS + WATCHDOG_GRACE_MS));
        if GENERATION.load(Ordering::SeqCst) != generation {
            // 期间又被触发过：这次兜底作废，由新的那一发负责。
            return;
        }
        if let Some(window) = handle.get_webview_window(CELEBRATION_WINDOW) {
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
                desktop::trace(&format!(
                    "celebrate[{}]: watchdog hid window (page never called hide_celebration)",
                    stamp()
                ));
            }
        }
    });
}

/// 前端到点后调它：只隐藏，不销毁（下次 show 直接复用同一个 webview）。
pub fn hide(app: &AppHandle) {
    let Some(window) = app.get_webview_window(CELEBRATION_WINDOW) else {
        desktop::trace("celebrate: hide command but window missing");
        return;
    };
    let was_visible = window.is_visible().unwrap_or(false);
    match window.hide() {
        Ok(()) => desktop::trace(&format!(
            "celebrate[{}]: hidden by frontend command (was_visible={was_visible})",
            stamp()
        )),
        Err(error) => desktop::trace(&format!("celebrate: hide failed: {error}")),
    }
}

/// 自动化验收开关（只在设了环境变量时生效，正常启动完全不受影响）：
/// - `celebrate`：启动 5 秒后 show 一次。
/// - `celebrate-twice`：5 秒 show，7 秒再 show 一次（露出期间重触发 -> 应重新计时）。
/// - `celebrate-hidden`：先把主卡藏到托盘再触发（预期一个窗口都不出现）。
pub fn run_startup_hook(app: &AppHandle) {
    let Ok(mode) = std::env::var(TEST_ENV) else {
        return;
    };
    // "celebrate@12000" = 启动 12 秒后再弹（真机验证时要先把主卡挪到有空间的位置再触发）。
    let (name, delay_ms) = match mode.split_once('@') {
        Some((name, delay)) => (name.to_string(), delay.parse::<u64>().unwrap_or(5_000)),
        None => (mode.clone(), 5_000),
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(delay_ms));
        desktop::trace(&format!("self-test[{}]: {TEST_ENV}={mode}", stamp()));
        match name.as_str() {
            "celebrate" => show(&handle),
            "celebrate-twice" => {
                show(&handle);
                std::thread::sleep(Duration::from_millis(2_000));
                desktop::trace(&format!(
                    "self-test[{}]: re-trigger 2s into the 4s window",
                    stamp()
                ));
                show(&handle);
            }
            // 走真实前端路径：让主窗口里的 JS 调 invoke("show_celebration")。
            // 与上面几条"直接调 show()"不同，这条会经过 Tauri 的命令派发 —— 正是用户实际触发的路径。
            "invoke-celebrate" => {
                match handle.get_webview_window(desktop::MAIN_WINDOW) {
                    Some(main) => {
                        let script = "window.__TAURI__.core.invoke('show_celebration')";
                        match main.eval(script) {
                            Ok(()) => desktop::trace("self-test: eval -> invoke(show_celebration) sent"),
                            Err(error) => desktop::trace(&format!("self-test: eval failed: {error}")),
                        }
                    }
                    None => desktop::trace("self-test: main window missing"),
                }
              }
            "celebrate-hidden" => {
                desktop::hide_main_window(&handle);
                std::thread::sleep(Duration::from_millis(500));
                show(&handle);
                desktop::trace("self-test: celebrate requested while main hidden (expected: no window)");
            }
            other => desktop::trace(&format!("self-test: unknown {TEST_ENV} value {other}")),
        }
    });
}
