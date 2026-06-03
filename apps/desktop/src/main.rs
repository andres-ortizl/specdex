#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::mpsc::channel;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use specdex_core::{fleet_snapshot, load_all, paths, FleetRow};
use tauri::{AppHandle, Emitter};

const STALE_SECS: i64 = 15 * 60;

fn snapshot() -> Vec<FleetRow> {
    match load_all() {
        Ok(specs) => fleet_snapshot(specs, chrono::Utc::now(), STALE_SECS),
        Err(_) => Vec::new(),
    }
}

/// Initial-load command the webview calls on mount.
#[tauri::command]
fn fleet() -> Vec<FleetRow> {
    snapshot()
}

fn emit_fleet(handle: &AppHandle) {
    let _ = handle.emit("fleet", snapshot());
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![fleet])
        .setup(|app| {
            let handle = app.handle().clone();
            // Watch the registry off-thread; push a fresh snapshot to the webview on change.
            std::thread::spawn(move || {
                emit_fleet(&handle);
                let root = match paths::spec_root() {
                    Ok(r) if r.exists() => r,
                    _ => return,
                };
                let (tx, rx) = channel();
                let mut watcher = match notify::recommended_watcher(move |res| {
                    let _ = tx.send(res);
                }) {
                    Ok(w) => w,
                    Err(_) => return,
                };
                if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
                    return;
                }
                while rx.recv().is_ok() {
                    while rx.try_recv().is_ok() {} // coalesce a burst
                    std::thread::sleep(Duration::from_millis(80));
                    emit_fleet(&handle);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running specdex");
}
