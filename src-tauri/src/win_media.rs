//! Windows: taskbar thumbnail buttons (previous, play/pause, next, mute) and the system media controls
//! (SMTC: Win11 media flyout with title, artist and cover, plus the keyboard media keys).
//!
//! The web app drives both through the `media_state` command and receives button presses as
//! `decibel://media` events ("previous", "play", "pause", "toggle", "next", "mute"). WebView2's own
//! media-key handling is turned off (`additionalBrowserArgs`), so Windows shows a single media control.
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{HSTRING, PCWSTR};
use windows::Foundation::{TypedEventHandler, Uri};
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls, SystemMediaTransportControlsButton,
    SystemMediaTransportControlsButtonPressedEventArgs,
};
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_ENABLED, THBN_CLICKED, THB_FLAGS, THB_ICON,
    THB_TOOLTIP, THUMBBUTTON, THUMBBUTTONMASK,
};
use windows::Win32::UI::WindowsAndMessaging::{CreateIconFromResourceEx, RegisterWindowMessageW, HICON, LR_DEFAULTCOLOR, WM_COMMAND};

const PREV: u32 = 1;
const PLAY: u32 = 2;
const NEXT: u32 = 3;
const MUTE: u32 = 4;
const EVENT: &str = "decibel://media";

struct Icons {
    prev: HICON,
    play: HICON,
    pause: HICON,
    next: HICON,
    volume: HICON,
    muted: HICON,
}

#[derive(Default, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub playing: bool,
    pub muted: bool,
    pub has_track: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub cover: Option<String>,
}

struct State {
    hwnd: isize,
    taskbar: Option<ITaskbarList3>,
    icons: Option<Icons>,
    buttons_added: bool,
    smtc: Option<SystemMediaTransportControls>,
    last: MediaState,
}

// The COM objects are only touched on the main (UI) thread; the mutex only guards the bookkeeping.
unsafe impl Send for State {}

static STATE: Mutex<Option<State>> = Mutex::new(None);
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);

/// Taskbar icons: white 16 px glyphs, ICO files with a single PNG image.
fn icon(ico: &[u8]) -> HICON {
    // ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes): image size at bytes 14..18, offset at 18..22.
    let size = u32::from_le_bytes([ico[14], ico[15], ico[16], ico[17]]) as usize;
    let offset = u32::from_le_bytes([ico[18], ico[19], ico[20], ico[21]]) as usize;
    let image = &ico[offset..offset + size];
    unsafe { CreateIconFromResourceEx(image, true, 0x0003_0000, 16, 16, LR_DEFAULTCOLOR).unwrap_or_default() }
}

fn tooltip(text: &str) -> [u16; 260] {
    let mut out = [0u16; 260];
    for (i, c) in text.encode_utf16().take(259).enumerate() {
        out[i] = c;
    }
    out
}

/// The thumbnail toolbar for the current state (play/pause and mute icons swap live).
fn buttons(icons: &Icons, state: &MediaState) -> [THUMBBUTTON; 4] {
    let mask = THUMBBUTTONMASK(THB_ICON.0 | THB_TOOLTIP.0 | THB_FLAGS.0);
    let button = |id: u32, hicon: HICON, tip: &str| THUMBBUTTON {
        dwMask: mask,
        iId: id,
        iBitmap: 0,
        hIcon: hicon,
        szTip: tooltip(tip),
        dwFlags: THBF_ENABLED,
    };
    [
        button(PREV, icons.prev, "Anterior"),
        if state.playing { button(PLAY, icons.pause, "Pausa") } else { button(PLAY, icons.play, "Reproducir") },
        button(NEXT, icons.next, "Siguiente"),
        if state.muted { button(MUTE, icons.muted, "Activar sonido") } else { button(MUTE, icons.volume, "Silenciar") },
    ]
}

fn emit(action: &str) {
    if let Some(app) = APP.lock().ok().and_then(|a| a.clone()) {
        let _ = app.emit(EVENT, action);
    }
}

fn refresh_buttons(state: &mut State) {
    let (Some(taskbar), Some(icons)) = (&state.taskbar, &state.icons) else { return };
    let hwnd = HWND(state.hwnd as *mut _);
    let list = buttons(icons, &state.last);
    unsafe {
        if state.buttons_added {
            let _ = taskbar.ThumbBarUpdateButtons(hwnd, &list);
        } else if taskbar.ThumbBarAddButtons(hwnd, &list).is_ok() {
            state.buttons_added = true;
        }
    }
}

unsafe extern "system" fn subclass(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, created: usize) -> LRESULT {
    if msg == created as u32 {
        // Explorer (re)created our taskbar button: the toolbar has to be added again.
        if let Ok(mut guard) = STATE.lock() {
            if let Some(state) = guard.as_mut() {
                state.buttons_added = false;
                refresh_buttons(state);
            }
        }
    } else if msg == WM_COMMAND && ((wparam.0 >> 16) & 0xffff) as u32 == THBN_CLICKED {
        match (wparam.0 & 0xffff) as u32 {
            PREV => emit("previous"),
            PLAY => emit("toggle"),
            NEXT => emit("next"),
            MUTE => emit("mute"),
            _ => {}
        }
        return LRESULT(0);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

fn smtc_for(hwnd: HWND) -> windows::core::Result<SystemMediaTransportControls> {
    let interop = windows::core::factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
    let smtc: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd)? };
    smtc.SetIsEnabled(true)?;
    smtc.SetIsPlayEnabled(true)?;
    smtc.SetIsPauseEnabled(true)?;
    smtc.SetIsNextEnabled(true)?;
    smtc.SetIsPreviousEnabled(true)?;
    smtc.ButtonPressed(&TypedEventHandler::<SystemMediaTransportControls, SystemMediaTransportControlsButtonPressedEventArgs>::new(
        |_, args| {
            if let Some(args) = args.as_ref() {
                let action = match args.Button()? {
                    SystemMediaTransportControlsButton::Play => "play",
                    SystemMediaTransportControlsButton::Pause => "pause",
                    SystemMediaTransportControlsButton::Next => "next",
                    SystemMediaTransportControlsButton::Previous => "previous",
                    _ => return Ok(()),
                };
                emit(action);
            }
            Ok(())
        },
    ))?;
    Ok(smtc)
}

fn update_smtc(smtc: &SystemMediaTransportControls, state: &MediaState, cover_changed: bool) -> windows::core::Result<()> {
    smtc.SetPlaybackStatus(if !state.has_track {
        MediaPlaybackStatus::Closed
    } else if state.playing {
        MediaPlaybackStatus::Playing
    } else {
        MediaPlaybackStatus::Paused
    })?;
    let display = smtc.DisplayUpdater()?;
    if !state.has_track {
        display.ClearAll()?;
        return display.Update();
    }
    display.SetType(MediaPlaybackType::Music)?;
    let music = display.MusicProperties()?;
    music.SetTitle(&HSTRING::from(state.title.clone().unwrap_or_default()))?;
    music.SetArtist(&HSTRING::from(state.artist.clone().unwrap_or_default()))?;
    music.SetAlbumTitle(&HSTRING::from(state.album.clone().unwrap_or_default()))?;
    if cover_changed {
        match state.cover.as_deref().filter(|c| c.starts_with("https://") || c.starts_with("http://")) {
            Some(cover) => display.SetThumbnail(&RandomAccessStreamReference::CreateFromUri(&Uri::CreateUri(&HSTRING::from(cover))?)?)?,
            None => display.SetThumbnail(None)?,
        }
    }
    display.Update()
}

/// Called once from setup with the main window.
pub fn init(window: &WebviewWindow) {
    *APP.lock().unwrap() = Some(window.app_handle().clone());
    let Ok(hwnd) = window.hwnd() else { return };
    let taskbar: Option<ITaskbarList3> = unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER).ok() };
    if let Some(t) = &taskbar {
        unsafe { let _ = t.HrInit(); }
    }
    let icons = Icons {
        prev: icon(include_bytes!("../icons-thumbbar/prev.ico")),
        play: icon(include_bytes!("../icons-thumbbar/play.ico")),
        pause: icon(include_bytes!("../icons-thumbbar/pause.ico")),
        next: icon(include_bytes!("../icons-thumbbar/next.ico")),
        volume: icon(include_bytes!("../icons-thumbbar/volume.ico")),
        muted: icon(include_bytes!("../icons-thumbbar/muted.ico")),
    };
    let created = unsafe { RegisterWindowMessageW(PCWSTR(HSTRING::from("TaskbarButtonCreated").as_ptr())) };
    let smtc = smtc_for(hwnd).ok();
    *STATE.lock().unwrap() = Some(State { hwnd: hwnd.0 as isize, taskbar, icons: Some(icons), buttons_added: false, smtc, last: MediaState::default() });
    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(subclass), 0xDEC1, created as usize);
    }
    // In case the taskbar button already exists (the message came before the subclass).
    if let Ok(mut guard) = STATE.lock() {
        if let Some(state) = guard.as_mut() {
            refresh_buttons(state);
        }
    }
}

/// Frontend → Windows: current track and play/mute state.
pub fn set_state(app: &AppHandle, next: MediaState) {
    let _ = app.run_on_main_thread(move || {
        let Ok(mut guard) = STATE.lock() else { return };
        let Some(state) = guard.as_mut() else { return };
        if state.last == next && state.buttons_added {
            return;
        }
        let cover_changed = state.last.cover != next.cover || state.last.title != next.title;
        let icons_changed = state.last.playing != next.playing || state.last.muted != next.muted || !state.buttons_added;
        state.last = next;
        if icons_changed {
            refresh_buttons(state);
        }
        if let Some(smtc) = &state.smtc {
            let _ = update_smtc(smtc, &state.last, cover_changed);
        }
    });
}

