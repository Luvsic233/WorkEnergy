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
//!
//! 两条位置纪律（都在这里做，前端只负责形变）：
//! 1. **不许被拖出工作区**：子类化窗口过程，截 WM_MOVING 把系统给出的候选 RECT 夹进
//!    「窗口所在显示器的工作区」（rcWork，多显示器时取候选矩形当前覆盖到的那些工作区的
//!    并集包围盒，于是跨屏时不会被拽回来，但一旦完全落在某块屏的工作区内就出不去）。
//!    选这条路而不是"观察线程里 SetWindowPos 纠正"：后者要和 OS 的移动循环抢同一个位置，
//!    逐帧纠正必然晚一帧、且与循环内的 SetWindowPos 交替写同一个窗口，抖动不可控；
//!    WM_MOVING 是 OS 主动问"这个位置行不行"，在这里改 RECT 是官方做法，零抖动。
//! 2. **压着边缘松手要弹走**：同一线程在松手后（等 OS 循环收尾）按压缩量把窗口往屏幕
//!    内部推 12 逻辑像素 / 220ms / ease-out，终点再夹一次工作区，然后停在那儿不再回贴边。

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicIsize, AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::desktop;

/// 进入边缘 24 逻辑像素开始渐入：必须与前端 src/ui/edgePressure.ts 的 EDGE_THRESHOLD 一致。
pub const THRESHOLD_LOGICAL: f64 = 24.0;

/// 松手弹走的距离（逻辑像素，满压缩时）。与前端 BOUNCE_DISTANCE 一致。
pub const BOUNCE_DISTANCE_LOGICAL: f64 = 24.0;
/// 松手弹走的时长（毫秒）。与前端 BOUNCE_MS 一致。
pub const BOUNCE_MS: u64 = 220;

/// 采样间隔（约 60Hz）。
const TICK: Duration = Duration::from_millis(16);
/// 弹走动画的帧间隔。
const BOUNCE_TICK: Duration = Duration::from_millis(16);
/// 松手后先让 OS 的移动循环把最后一次 SetWindowPos 做完，再开始动画（否则会互相盖掉）。
const RELEASE_SETTLE: Duration = Duration::from_millis(20);
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

/// 已装夹取保护的那个窗口句柄（0 = 没装）。
static GUARDED_HWND: AtomicIsize = AtomicIsize::new(0);
/// 子类化之前窗口原来的 WNDPROC，恢复时要用。
static PREV_WNDPROC: AtomicIsize = AtomicIsize::new(0);
/// 子类化后见过的最大的越界量（物理像素），只用于日志对账。
static MAX_OVERHANG: AtomicI64 = AtomicI64::new(0);
/// 已经夹过多少次。
static CLAMPED: AtomicU64 = AtomicU64::new(0);

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

#[derive(Clone, Copy)]
struct Sample {
    edges: Edges,
    scale: f64,
    /// 物理像素窗口矩形，只写进日志 / payload 方便对账。
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

/// 起一次观察。IPC 里只做"取句柄 + 装夹取 + 起线程"，一切采样都在线程里。
///
/// bounce：松手是否弹走（减弱动效偏好由前端决定，见 useEdgePressure.ts）。
pub fn begin(app: &AppHandle, bounce: bool) -> Result<(), String> {
    let window = desktop::main_window(app).ok_or_else(|| "main window missing".to_string())?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let hwnd = hwnd.0 as isize;
    // 夹取必须赶在移动循环之前装好。装不上不算致命（拖动还能用，只是没有边界保护），
    // 但必须留下痕迹，否则"没夹住"会变成一个查不到来源的现场。
    if let Err(error) = install_move_guard(hwnd) {
        desktop::trace(&format!("edge-watch: move guard install failed: {error}"));
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    thread::Builder::new()
        .name("edge-watch".into())
        .spawn(move || watch(handle, hwnd, generation, bounce))
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// 主动结束当前观察（组件卸载 / 应用收尾）。线程在下一个 tick 自行退出。
pub fn stop() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    remove_move_guard();
    desktop::trace("edge-watch: stop requested");
}

fn watch(app: AppHandle, hwnd: isize, generation: u64, bounce: bool) {
    let started = Instant::now();
    let watchdog = watchdog_limit();
    desktop::trace(&format!(
        "edge-watch: start hwnd=0x{hwnd:x} threshold={THRESHOLD_LOGICAL} tick={}ms watchdog={:.1}s bounce={}",
        TICK.as_millis(),
        watchdog.as_secs_f64(),
        u8::from(bounce)
    ));

    let mut last: Option<Edges> = None;
    let mut last_pos: Option<(i32, i32)> = None;
    // 这一次手势里窗口真的被移动过（纯点击不算拖动，不该弹走）。
    let mut dragged = false;

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
                if let Some(previous) = last_pos {
                    if previous != (current.x, current.y) {
                        dragged = true;
                    }
                }
                last_pos = Some((current.x, current.y));
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
        "edge-watch: end reason={reason} after {}ms dragged={}",
        started.elapsed().as_millis(),
        u8::from(dragged)
    ));
    // 被新一次观察顶掉时不发 end：新的那一次会自己接管事件流。
    if reason != "superseded" {
        let _ = app.emit(EVENT_END, ());
    }
    // 松手后弹走：前端那 500ms 的形变回弹已经在播了，这里补上窗口本身的位移。
    if reason == "released" && dragged && bounce {
        bounce_away(hwnd, generation);
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

/// 弹走的方向与位移（物理像素）。纯算术：方向沿被压那条边的法线朝内，角落两方向合成，
/// 距离按压缩量等比缩放；压缩量为 0 时返回 (0, 0)（= 不弹）。
fn bounce_delta(edges: Edges, scale: f64, distance_logical: f64) -> (i32, i32) {
    let left = proximity(edges.left);
    let right = proximity(edges.right);
    let top = proximity(edges.top);
    let bottom = proximity(edges.bottom);
    let dx = distance_logical * (left - right);
    let dy = distance_logical * (top - bottom);
    if dx.abs() < 0.5 && dy.abs() < 0.5 {
        return (0, 0);
    }
    ((dx * scale).round() as i32, (dy * scale).round() as i32)
}

/// ease-out cubic：与前端 bounceEase 同一条曲线。
fn bounce_ease(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t) * (1.0 - t) * (1.0 - t)
}

/// 松手后把窗口往屏幕内部"弹"一段，然后停在那儿（不回贴边）。
#[cfg(windows)]
fn bounce_away(hwnd: isize, generation: u64) {
    // 等 OS 的移动循环收尾：它会用最后一次 SetWindowPos 落地，我们不能和它抢。
    thread::sleep(RELEASE_SETTLE);
    let Some(start) = sample(hwnd) else {
        desktop::trace("edge-watch: bounce skipped (window gone)");
        return;
    };
    let (dx, dy) = bounce_delta(start.edges, start.scale, BOUNCE_DISTANCE_LOGICAL);
    if dx == 0 && dy == 0 {
        desktop::trace("edge-watch: bounce skipped (no compression)");
        return;
    }
    let mut target = raw::RECT {
        left: start.x + dx,
        top: start.y + dy,
        right: start.x + dx + start.width,
        bottom: start.y + dy + start.height,
    };
    // 终点也必须落在工作区内：绝不从一边弹到越界。
    if let Some(work) = allowed_region(&target) {
        let shift = raw::clamp_rect(&mut target, &work);
        if shift != 0 {
            desktop::trace(&format!("edge-watch: bounce target clamped by {shift}px"));
        }
    }
    desktop::trace(&format!(
        "edge-watch: bounce plan from=({},{}) to=({},{}) delta=({dx},{dy}) phys={}ms scale={:.2}",
        start.x,
        start.y,
        target.left,
        target.top,
        BOUNCE_MS,
        start.scale
    ));

    let origin_left = start.x;
    let origin_top = start.y;
    let began = Instant::now();
    loop {
        if GENERATION.load(Ordering::SeqCst) != generation {
            desktop::trace("edge-watch: bounce aborted (superseded)");
            return;
        }
        let elapsed = began.elapsed();
        let t = elapsed.as_secs_f64() / (BOUNCE_MS as f64 / 1000.0);
        let (x, y) = if t >= 1.0 {
            (target.left, target.top)
        } else {
            let eased = bounce_ease(t);
            (
                origin_left + ((target.left - origin_left) as f64 * eased).round() as i32,
                origin_top + ((target.top - origin_top) as f64 * eased).round() as i32,
            )
        };
        move_window(hwnd, x, y);
        desktop::trace(&format!(
            "edge-watch: bounce frame t={:.3} at=({x},{y}) elapsed={}ms",
            t.min(1.0),
            elapsed.as_millis()
        ));
        if t >= 1.0 {
            break;
        }
        thread::sleep(BOUNCE_TICK);
    }
    // 落地点再确认一次：既保证终态精确，也留下"停在离边缘多远"的证据。
    move_window(hwnd, target.left, target.top);
    desktop::trace(&format!(
        "edge-watch: bounce done after {}ms final=({},{})",
        began.elapsed().as_millis(),
        target.left,
        target.top
    ));
}

#[cfg(not(windows))]
fn bounce_away(_hwnd: isize, _generation: u64) {}

#[cfg(windows)]
fn move_window(hwnd: isize, x: i32, y: i32) {
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOOWNERZORDER: u32 = 0x0200;
    // ASYNC：拖动刚结束，主线程可能还在忙，同步消息会把本线程挂住。
    const SWP_ASYNCWINDOWPOS: u32 = 0x4000;
    unsafe {
        raw::SetWindowPos(
            hwnd as *mut std::ffi::c_void,
            std::ptr::null_mut(),
            x,
            y,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS,
        );
    }
}

/// 装夹取：子类化窗口过程，拦 WM_MOVING。
#[cfg(windows)]
fn install_move_guard(hwnd: isize) -> Result<(), String> {
    if GUARDED_HWND.load(Ordering::SeqCst) == hwnd {
        return Ok(());
    }
    if GUARDED_HWND.load(Ordering::SeqCst) != 0 {
        return Err("move guard already bound to another window".to_string());
    }
    let raw_hwnd = hwnd as *mut std::ffi::c_void;
    unsafe {
        let prev = raw::GetWindowLongPtrW(raw_hwnd, raw::GWLP_WNDPROC);
        if prev == 0 {
            return Err("GetWindowLongPtrW returned 0".to_string());
        }
        // 先存旧过程再换：换完立刻有 WM_MOVING 进来的话，回调里必须已经能拿到旧过程。
        PREV_WNDPROC.store(prev, Ordering::SeqCst);
        let handler = raw::handler_address();
        let replaced = raw::SetWindowLongPtrW(raw_hwnd, raw::GWLP_WNDPROC, handler);
        if raw::GetWindowLongPtrW(raw_hwnd, raw::GWLP_WNDPROC) != handler {
            PREV_WNDPROC.store(0, Ordering::SeqCst);
            return Err(format!("SetWindowLongPtrW failed (prev=0x{replaced:x})"));
        }
        GUARDED_HWND.store(hwnd, Ordering::SeqCst);
    }
    desktop::trace(&format!(
        "edge-watch: move guard installed hwnd=0x{hwnd:x} prev=0x{:x}",
        PREV_WNDPROC.load(Ordering::SeqCst)
    ));
    Ok(())
}

/// 卸夹取：把原来的窗口过程还回去（不还就是永久泄漏一个栈上的回调地址）。
#[cfg(windows)]
fn remove_move_guard() {
    let hwnd = GUARDED_HWND.swap(0, Ordering::SeqCst);
    let prev = PREV_WNDPROC.swap(0, Ordering::SeqCst);
    if hwnd == 0 || prev == 0 {
        return;
    }
    unsafe {
        raw::SetWindowLongPtrW(hwnd as *mut std::ffi::c_void, raw::GWLP_WNDPROC, prev);
    }
    desktop::trace(&format!("edge-watch: move guard removed hwnd=0x{hwnd:x}"));
}

#[cfg(not(windows))]
fn install_move_guard(_hwnd: isize) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn remove_move_guard() {}

/// 允许的移动范围：候选矩形当前覆盖到的所有显示器工作区的并集包围盒。
///
/// 为什么不直接用 MonitorFromWindow：跨屏拖动时窗口一半在这块屏、一半在另一块，
/// 取"遮挡最多的那块"会在跨过缝隙的一瞬间把窗口整块拽回去，等于禁止跨屏。
/// 用并集包围盒则天然满足两条要求：完全落在某块屏里时它就是那块屏的 rcWork（出不去），
/// 跨屏时允许停在两块屏的工作区之间。候选矩形完全不在任何工作区内（拖太快）时，
/// 退化成 MonitorFromRect(DEFAULTTONEAREST) 的那块，保证总能夹回来。
#[cfg(windows)]
fn allowed_region(rect: &raw::RECT) -> Option<raw::RECT> {
    use raw::*;
    unsafe {
        let mut ctx = RegionCtx {
            rect: *rect,
            region: RECT::default(),
            found: false,
        };
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            Some(region_cb),
            &mut ctx as *mut RegionCtx as isize,
        );
        if ctx.found {
            return Some(ctx.region);
        }
        let monitor = MonitorFromRect(rect, MONITOR_DEFAULTTONEAREST);
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
        Some(work_of(&info))
    }
}

#[cfg(windows)]
struct RegionCtx {
    rect: raw::RECT,
    region: raw::RECT,
    found: bool,
}

#[cfg(windows)]
extern "system" fn region_cb(
    monitor: *mut std::ffi::c_void,
    _hdc: *mut std::ffi::c_void,
    _clip: *mut raw::RECT,
    data: isize,
) -> i32 {
    use raw::*;
    unsafe {
        if data == 0 {
            return 0;
        }
        let ctx = &mut *(data as *mut RegionCtx);
        let mut info = MONITORINFO {
            cb_size: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return 1;
        }
        let work = work_of(&info);
        if !intersects(&ctx.rect, &work) {
            return 1;
        }
        if !ctx.found {
            ctx.region = work;
            ctx.found = true;
        } else {
            ctx.region.left = ctx.region.left.min(work.left);
            ctx.region.top = ctx.region.top.min(work.top);
            ctx.region.right = ctx.region.right.max(work.right);
            ctx.region.bottom = ctx.region.bottom.max(work.bottom);
        }
    }
    1
}

/// 工作区优先（任务栏不算边缘）；拿不到时退化成整屏矩形。
#[cfg(windows)]
fn work_of(info: &raw::MONITORINFO) -> raw::RECT {
    if info.rc_work.right > info.rc_work.left && info.rc_work.bottom > info.rc_work.top {
        info.rc_work
    } else {
        info.rc_monitor
    }
}

#[cfg(windows)]
fn intersects(a: &raw::RECT, b: &raw::RECT) -> bool {
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
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
        let work = work_of(&info);
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
    /// 窗口过程地址这一格（32/64 位都是 -4）。
    pub const GWLP_WNDPROC: i32 = -4;
    /// 拖动中：lParam 指向候选 RECT，改它就是改窗口将要落地的位置。
    pub const WM_MOVING: u32 = 0x0216;

    /// 窗口过程签名。
    pub type WndProc = extern "system" fn(*mut c_void, u32, usize, isize) -> isize;

    /// 派生出来的窗口过程地址（SetWindowLongPtrW 要的是数字）。
    pub fn handler_address() -> isize {
        guard_proc as WndProc as usize as isize
    }

    /// 派生：夹完之后的窗口过程。除 WM_MOVING 外一律原样转给旧过程。
    pub extern "system" fn guard_proc(
        hwnd: *mut c_void,
        msg: u32,
        wparam: usize,
        lparam: isize,
    ) -> isize {
        if msg == WM_MOVING && lparam != 0 {
            unsafe {
                let proposed = &mut *(lparam as *mut RECT);
                if let Some(work) = super::allowed_region(proposed) {
                    let overhang = super::overhang(proposed, &work);
                    if overhang > 0 {
                        let seen = super::MAX_OVERHANG.fetch_max(overhang as i64, super::Ordering::SeqCst);
                        let count = super::CLAMPED.fetch_add(1, super::Ordering::SeqCst) + 1;
                        if overhang as i64 > seen {
                            super::desktop::trace(&format!(
                                "edge-watch: move clamped overhang={overhang}px total={count} rect={}x{}+{}+{} work={}x{}+{}+{}",
                                proposed.right - proposed.left,
                                proposed.bottom - proposed.top,
                                proposed.left,
                                proposed.top,
                                work.right - work.left,
                                work.bottom - work.top,
                                work.left,
                                work.top
                            ));
                        }
                    }
                    clamp_rect(proposed, &work);
                }
            }
            // TRUE：告诉系统"我改过这条消息里的 RECT 了"。
            return 1;
        }
        let prev = super::PREV_WNDPROC.load(super::Ordering::SeqCst);
        if prev == 0 {
            return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
        }
        unsafe { CallWindowProcW(prev, hwnd, msg, wparam, lparam) }
    }

    /// 夹进工作区，返回被消掉的越界像素（0 = 本来就在里面）。
    /// 比工作区还大的窗口：左上角对齐，允许另一端超出（可见面积最大，且不会被反复推动）。
    pub fn clamp_rect(rect: &mut RECT, work: &RECT) -> i32 {
        let dx = clamp_axis(&mut rect.left, &mut rect.right, work.left, work.right - work.left);
        let dy = clamp_axis(&mut rect.top, &mut rect.bottom, work.top, work.bottom - work.top);
        dx + dy
    }

    fn clamp_axis(start: &mut i32, end: &mut i32, area_start: i32, area_size: i32) -> i32 {
        let size = *end - *start;
        let target = if size >= area_size {
            area_start
        } else {
            (*start).clamp(area_start, area_start + area_size - size)
        };
        let shift = target - *start;
        *start += shift;
        *end += shift;
        shift.abs()
    }

    // 零新增依赖：这几个全是 user32 里的老 API，直接裸 FFI 声明。
    #[link(name = "user32")]
    extern "system" {
        pub fn GetAsyncKeyState(vkey: i32) -> i16;
        pub fn GetWindowRect(hwnd: *mut c_void, rect: *mut RECT) -> i32;
        pub fn IsWindow(hwnd: *mut c_void) -> i32;
        pub fn IsWindowVisible(hwnd: *mut c_void) -> i32;
        pub fn MonitorFromWindow(hwnd: *mut c_void, flags: u32) -> *mut c_void;
        pub fn MonitorFromRect(rect: *const RECT, flags: u32) -> *mut c_void;
        pub fn GetMonitorInfoW(monitor: *mut c_void, info: *mut MONITORINFO) -> i32;
        pub fn GetDpiForWindow(hwnd: *mut c_void) -> u32;
        pub fn SetWindowPos(
            hwnd: *mut c_void,
            insert_after: *mut c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
        pub fn EnumDisplayMonitors(
            hdc: *mut c_void,
            clip: *mut RECT,
            callback: Option<
                extern "system" fn(*mut c_void, *mut c_void, *mut RECT, isize) -> i32,
            >,
            data: isize,
        ) -> i32;
        pub fn GetWindowLongPtrW(hwnd: *mut c_void, index: i32) -> isize;
        pub fn SetWindowLongPtrW(hwnd: *mut c_void, index: i32, value: isize) -> isize;
        pub fn CallWindowProcW(prev: isize, hwnd: *mut c_void, msg: u32, wparam: usize, lparam: isize) -> isize;
        pub fn DefWindowProcW(hwnd: *mut c_void, msg: u32, wparam: usize, lparam: isize) -> isize;
    }
}

#[cfg(windows)]
/// 这个矩形越出了工作区多少像素（只看"窗口比工作区小的那个轴"，另一轴本来就会被故意超出）。
#[cfg(windows)]
fn overhang(rect: &raw::RECT, work: &raw::RECT) -> i32 {
    let horizontal = if rect.right - rect.left >= work.right - work.left {
        0
    } else {
        (work.left - rect.left).max(rect.right - work.right).max(0)
    };
    let vertical = if rect.bottom - rect.top >= work.bottom - work.top {
        0
    } else {
        (work.top - rect.top).max(rect.bottom - work.bottom).max(0)
    };
    horizontal.max(vertical)
}

#[cfg(all(test, windows))]
mod tests {
    use super::{bounce_delta, bounce_ease, proximity, Edges, BOUNCE_DISTANCE_LOGICAL, BOUNCE_MS};

    #[test]
    fn proximity_hits_both_bounds() {
        assert_eq!(proximity(0.0), 1.0);
        assert_eq!(proximity(super::THRESHOLD_LOGICAL), 0.0);
        assert_eq!(proximity(200.0), 0.0);
        assert_eq!(proximity(-30.0), 1.0);
        assert!((proximity(12.0) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn constants_match_the_front_end() {
        // 与 src/ui/edgePressure.ts 的 BOUNCE_DISTANCE / BOUNCE_MS 一致。
        assert_eq!(BOUNCE_DISTANCE_LOGICAL, 24.0);
        assert_eq!(BOUNCE_MS, 220);
    }

    const FAR: Edges = Edges {
        left: 400.0,
        right: 400.0,
        top: 200.0,
        bottom: 200.0,
    };

    #[test]
    fn bounce_delta_points_inwards_on_every_edge() {
        let left = Edges { left: 0.0, ..FAR };
        assert_eq!(bounce_delta(left, 1.0, 12.0), (12, 0));
        let right = Edges { right: 0.0, ..FAR };
        assert_eq!(bounce_delta(right, 1.0, 12.0), (-12, 0));
        let top = Edges { top: 0.0, ..FAR };
        assert_eq!(bounce_delta(top, 1.0, 12.0), (0, 12));
        let bottom = Edges { bottom: 0.0, ..FAR };
        assert_eq!(bounce_delta(bottom, 1.0, 12.0), (0, -12));
    }

    #[test]
    fn bounce_delta_composes_a_corner() {
        let corner = Edges {
            left: 0.0,
            right: 400.0,
            top: 0.0,
            bottom: 200.0,
        };
        assert_eq!(bounce_delta(corner, 1.0, 12.0), (12, 12));
    }

    #[test]
    fn bounce_delta_scales_with_compression_and_respects_dpi() {
        // 压缩一半 -> 6 逻辑像素；2.0 倍缩放（200% DPI）-> 12 物理像素。
        let half = Edges { left: 12.0, ..FAR };
        assert_eq!(bounce_delta(half, 1.0, 12.0), (6, 0));
        assert_eq!(bounce_delta(half, 2.0, 12.0), (12, 0));
        // 1.5 倍缩放：6 * 1.5 = 9。
        assert_eq!(bounce_delta(half, 1.5, 12.0), (9, 0));
    }

    #[test]
    fn bounce_delta_is_zero_when_nothing_is_compressed() {
        assert_eq!(bounce_delta(FAR, 1.0, 12.0), (0, 0));
        let at_threshold = Edges {
            left: super::THRESHOLD_LOGICAL,
            ..FAR
        };
        assert_eq!(bounce_delta(at_threshold, 1.0, 12.0), (0, 0));
    }

    #[test]
    fn bounce_ease_is_an_ease_out() {
        assert_eq!(bounce_ease(0.0), 0.0);
        assert_eq!(bounce_ease(1.0), 1.0);
        assert!(bounce_ease(0.5) > 0.5);
        assert!((bounce_ease(0.5) - 0.875).abs() < 1e-12);
        let mut last = 1.0;
        for step in 1..=14 {
            let delta = bounce_ease(step as f64 / 14.0) - bounce_ease((step - 1) as f64 / 14.0);
            assert!(delta > 0.0);
            assert!(delta <= last + 1e-12);
            last = delta;
        }
    }

    #[test]
    fn clamp_rect_matches_the_front_end_rules() {
        use super::raw::{clamp_rect, RECT};
        let work = RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1032,
        };

        let mut inside = RECT {
            left: 640,
            top: 400,
            right: 960,
            bottom: 496,
        };
        assert_eq!(clamp_rect(&mut inside, &work), 0);
        assert_eq!((inside.left, inside.top), (640, 400));

        let mut over = RECT {
            left: -6,
            top: -6,
            right: 314,
            bottom: 90,
        };
        assert_eq!(clamp_rect(&mut over, &work), 12);
        assert_eq!((over.left, over.right, over.top, over.bottom), (0, 320, 0, 96));

        let mut far = RECT {
            left: 9000,
            top: 9000,
            right: 9320,
            bottom: 9096,
        };
        clamp_rect(&mut far, &work);
        assert_eq!((far.left, far.top), (1600, 936));

        // 比工作区还大：左上对齐，允许另一端超出。
        let mut huge = RECT {
            left: -50,
            top: -50,
            right: 2350,
            bottom: 1350,
        };
        clamp_rect(&mut huge, &work);
        assert_eq!((huge.left, huge.top, huge.right, huge.bottom), (0, 0, 2400, 1400));

        // 副屏在主屏左边：负坐标照常处理。
        let secondary = RECT {
            left: -1920,
            top: -200,
            right: 0,
            bottom: 880,
        };
        let mut negative = RECT {
            left: -2000,
            top: 0,
            right: -1680,
            bottom: 96,
        };
        clamp_rect(&mut negative, &secondary);
        assert_eq!((negative.left, negative.top), (-1920, 0));
    }
}