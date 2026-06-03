#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::mpsc::channel;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use specdex_core::{
    fleet_snapshot, load_all, load_logbook, load_spec_doc, load_state, paths, read_events,
    FleetRow,
};
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

/// Full detail for one spec: snapshot state, derived health, the event log, and
/// the `spec.md` / `logbook.md` docs (if present).
#[tauri::command]
fn spec_detail(project: String, name: String) -> serde_json::Value {
    let state = load_state(&project, &name).ok().flatten();
    let health = state.as_ref().map(|s| s.health(chrono::Utc::now(), STALE_SECS).label().to_string());
    let events = read_events(&project, &name).unwrap_or_default();
    let doc = load_spec_doc(&project, &name).ok().flatten();
    let logbook = load_logbook(&project, &name).ok().flatten();
    serde_json::json!({ "state": state, "health": health, "events": events, "doc": doc, "logbook": logbook })
}

/// One project's effective `.dex.toml` config (read-only), or null if none resolves.
#[tauri::command]
fn project_config(project: String) -> Option<serde_json::Value> {
    specdex_core::project_config(&project).ok().flatten().map(|c| serde_json::json!(c))
}

fn emit_fleet(handle: &AppHandle) {
    let _ = handle.emit("fleet", snapshot());
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![fleet, spec_detail, project_config])
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
