#[cfg(windows)]
mod win_media;

/// Frontend → OS media integration (Windows: taskbar buttons + system media controls; elsewhere a no-op,
/// Linux gets MPRIS from WebKitGTK's Media Session support).
#[cfg(desktop)]
#[tauri::command]
fn media_state(app: tauri::AppHandle, state: serde_json::Value) {
    #[cfg(windows)]
    if let Ok(state) = serde_json::from_value::<win_media::MediaState>(state) {
        win_media::set_state(&app, state);
    }
    #[cfg(not(windows))]
    let _ = (app, state);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Desktop (Windows/Linux): self-update through the Tauri updater. Its endpoint and public key are injected
    // at build time (scripts/build-desktop.mjs); a build without them simply runs without updates.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![media_state])
        .setup(|app| {
            if app.config().plugins.0.contains_key("updater") {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    win_media::init(&window);
                }
            }
            Ok(())
        });
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
