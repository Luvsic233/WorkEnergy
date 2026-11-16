//! 拖动贴边的观察线程。
//!
//! 为什么必须放在 Rust 侧：拖动走的是 start_dragging（OS 窗口移动循环），
//! 那个循环一开，webview 就再也收不到 pointerup / mouseup / click（真机实测），
//! 位置与"松手"这两件事在前端无从得知。于是前端在发起拖动之前先调 begin_edge_watch，
//! 这里起一个受限的观察线程，用 Win32 直接读鼠标按键与窗口矩形，把结果 emit 回前端。
//!
//! 线程纪律：
//! - 只用 Win32（GetAsyncKeyState / GetWindowRect / GetMonitorInfoW / GetDpiForWindow），
//!   一次采样全是用户态廉价调用，**不碰 Tauri 的窗口 API**，所以不会去等主线程
//!   （拖动期间主线程在模态移动循环里，任何需要它回话的 API 都可能把工作线程挂住）；
//! - 约 60Hz、最长 30 秒看门狗、贴近度没变化就不发事件；
//! - 左键松开 / 窗口不可见 / 看门狗超时 / 被新一次观察顶掉，四条路都会让线程自己结束。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::desktop;

/// 进入边缘 24 逻辑像素开始渐入：必须与前端 src/ui/edgePressure.ts 的 EDGE_THRESHOLD 一致。
pub const THRESHOLD_LOGICAL: f64 = 24.0;

/// 采样间隔（约 60Hz）。
const TICK: Duration = Duration::from_millis(16);
/// 看门狗：一次拖动不会很久，超时就让线程自己结束，绝不永久占住一个线程。
const WATCHDOG: Duration = Duration::from_secs(30);

/// 看门狗时长可以被 WE_EDGE_WATCH_SECS 覆盖（只给自测用，正式运行永远走 30 秒默认值）。
fn watchdog_limit() -> Duration {
    std::env::var("WE_EDGE_WATCH_SECS")
        .ok()
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|secs| *secs > 0.0 && *secs <= 600.0)
        .map(Duration::from_secs_f64)
        .unwrap_or(WATCHDOG)
}

/// 贴近度事件（payload 是扁平的数值表，见 emit_edge）。
pub const EVENT_EDGE: &str = "bar:edge";
/// 松手 / 结束事件：前端据它播放回弹。
pub const EVENT_END: &str = "bar:edge-end";

/// 观察线程的代次：新的观察或主动结束都会 +1，旧线程据此立刻退出。
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// 窗口四条边到"工作区"对应边的剩余距离（逻辑像素，负数表示已经越过边缘）。
#[derive(Clone, Copy)]
struct Edges {
    left: f64,
    right: f64,
    top: f64,
    bottom: f64,
}

impl Edges {
    /// 只比"看得见的差异"：亚像素抖动不算变化，避免 60Hz 刷屏。
    fn same_as(&self, other: &Edges) -> bool {
        (self.left - other.left).abs() < 0.01
            && (self.right - other.right).abs() < 0.01
            && (self.top - other.top).abs() < 0.01
            && (self.bottom - other.bottom).abs() < 0.01
    }

    fn closeness(&self) -> [f64; 4] {
        [
            proximity(self.left),
            proximity(self.right),
            proximity(self.top),
            proximity(self.bottom),
        ]
    }
}

/// 距离 -> 0..1 贴近度：正好 0 贴死是 1，正好 24 逻辑像素是 0，越界（负数）夹到 1。
fn proximity(distance: f64) -> f64 {
    (1.0 - distance / THRESHOLD_LOGICAL).clamp(0.0, 1.0)
}

struct Sample {
    edges: Edges,
    scale: f64,
    /// 物理像素窗口矩形，只写进日志 / payload 方便对账。
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

/// 起一次观察。IPC 里只做"取句柄 + 起线程"，一切采样都在线程里。
pub fn begin(app: &AppHandle) -> Result<(), String> {
    let window = desktop::main_window(app).ok_or_else(|| "main window missing".to_string())?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let hwnd = hwnd.0 as isize;
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    thread::Builder::new()
        .name("edge-watch".into())
        .spawn(move || watch(handle, hwnd, generation))
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// 主动结束当前观察（组件卸载 / 应用收尾）。线程在下一个 tick 自行退出。
pub fn stop() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    desktop::trace("edge-watch: stop requested");
}

fn watch(app: AppHandle, hwnd: isize, generation: u64) {
    let started = Instant::now();
    let watchdog = watchdog_limit();
    desktop::trace(&format!(
        "edge-watch: start hwnd=0x{hwnd:x} threshold={THRESHOLD_LOGICAL} tick={}ms watchdog={:.1}s",
        TICK.as_millis(),
        watchdog.as_secs_f64()
    ));

    let mut last: Option<Edges> = None;
    let reason = loop {
        if GENERATION.load(Ordering::SeqCst) != generation {
            break "superseded";
        }
        if started.elapsed() >= watchdog {
            break "watchdog";
        }
        if !left_button_down() {
            break "released";
        }
        match sample(hwnd) {
            Some(current) => {
                let changed = match last {
                    None => true,
                    Some(previous) => !previous.same_as(&current.edges),
                };
                if changed {
                    emit_edge(&app, &current);
                    last = Some(current.edges);
                }
            }
            // 窗口被隐藏 / 销毁：没有继续观察的意义。
            None => break "window-gone",
        }
        thread::sleep(TICK);
    };

    desktop::trace(&format!(
        "edge-watch: end reason={reason} after {}ms",
        started.elapsed().as_millis()
    ));
    // 被新一次观察顶掉时不发 end：新的那一次会自己接管事件流。
    if reason != "superseded" {
        let _ = app.emit(EVENT_END, ());
    }
}

fn emit_edge(app: &AppHandle, sample: &Sample) {
    let [left, right, top, bottom] = sample.edges.closeness();
    let mut payload: HashMap<&'static str, f64> = HashMap::new();
    // 贴近度（0..1）：事件规范里的字段，便于日志对账与"零变化不发事件"的判定。
    payload.insert("left", left);
    payload.insert("right", right);
    payload.insert("top", top);
    payload.insert("bottom", bottom);
    // 同一份距离的原始逻辑像素值：前端的压缩量由它算（贴死 / 越界都能表达，贴近度夹到 1 之后不行）。
    payload.insert("pxLeft", sample.edges.left);
    payload.insert("pxRight", sample.edges.right);
    payload.insert("pxTop", sample.edges.top);
    payload.insert("pxBottom", sample.edges.bottom);
    payload.insert("scaleFactor", sample.scale);
    payload.insert("x", sample.x as f64);
    payload.insert("y", sample.y as f64);
    payload.insert("width", sample.width as f64);
    payload.insert("height", sample.height as f64);
    let _ = app.emit(EVENT_EDGE, payload);
    desktop::trace(&format!(
        "edge-watch: edge left={left:.3} right={right:.3} top={top:.3} bottom={bottom:.3} px=({:.1},{:.1},{:.1},{:.1}) scale={:.2} rect={}x{}+{}+{}",
        sample.edges.left,
        sample.edges.right,
        sample.edges.top,
        sample.edges.bottom,
        sample.scale,
        sample.width,
        sample.height,
        sample.x,
        sample.y
    ));
}

/// 左键是否还按着：拖动期间前端收不到任何鼠标事件，这是唯一可靠的信源。
#[cfg(windows)]
fn left_button_down() -> bool {
    const VK_LBUTTON: i32 = 0x01;
    unsafe { (raw::GetAsyncKeyState(VK_LBUTTON) as u16 & 0x8000) != 0 }
}

#[cfg(not(windows))]
fn left_button_down() -> bool {
    false
}

#[cfg(windows)]
fn sample(hwnd: isize) -> Option<Sample> {
    use raw::*;

    unsafe {
        let hwnd = hwnd as *mut std::ffi::c_void;
        if IsWindow(hwnd) == 0 || IsWindowVisible(hwnd) == 0 {
            return None;
        }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return None;
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.is_null() {
            return None;
        }
        let mut info = MONITORINFO {
            cb_size: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return None;
        }
        // 工作区优先（任务栏不算边缘）；拿不到时退化成整屏矩形。
        let work = if info.rc_work.right > info.rc_work.left {
            info.rc_work
        } else {
            info.rc_monitor
        };
        let mut dpi = GetDpiForWindow(hwnd);
        if dpi == 0 {
            dpi = 96;
        }
        let scale = dpi as f64 / 96.0;
        Some(Sample {
            edges: Edges {
                left: (rect.left - work.left) as f64 / scale,
                right: (work.right - rect.right) as f64 / scale,
                top: (rect.top - work.top) as f64 / scale,
                bottom: (work.bottom - rect.bottom) as f64 / scale,
            },
            scale,
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
        })
    }
}

#[cfg(not(windows))]
fn sample(_hwnd: isize) -> Option<Sample> {
    None
}

#[cfg(windows)]
mod raw {
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct RECT {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct MONITORINFO {
        pub cb_size: u32,
        pub rc_monitor: RECT,
        pub rc_work: RECT,
        pub dw_flags: u32,
    }

    pub const MONITOR_DEFAULTTONEAREST: u32 = 0x0000_0002;

    // 零新增依赖：这几个全是 user32 里的老 API，直接裸 FFI 声明。
    #[link(name = "user32")]
    extern "system" {
        pub fn GetAsyncKeyState(vkey: i32) -> i16;
        pub fn GetWindowRect(hwnd: *mut c_void, rect: *mut RECT) -> i32;
        pub fn IsWindow(hwnd: *mut c_void) -> i32;
        pub fn IsWindowVisible(hwnd: *mut c_void) -> i32;
        pub fn MonitorFromWindow(hwnd: *mut c_void, flags: u32) -> *mut c_void;
        pub fn GetMonitorInfoW(monitor: *mut c_void, info: *mut MONITORINFO) -> i32;
        pub fn GetDpiForWindow(hwnd: *mut c_void) -> u32;
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::proximity;

    #[test]
    fn proximity_hits_both_bounds() {
        assert_eq!(proximity(0.0), 1.0);
        assert_eq!(proximity(super::THRESHOLD_LOGICAL), 0.0);
        assert_eq!(proximity(200.0), 0.0);
        assert_eq!(proximity(-30.0), 1.0);
        assert!((proximity(12.0) - 0.5).abs() < 1e-9);
    }
}
