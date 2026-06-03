pub mod config;
pub mod event;
pub mod paths;
pub mod ports;
pub mod state;
pub mod view;

pub use config::{
    config_path, get_dotted, load_effective, load_effective_opt, reactor_for, referenced_skills,
    schema, validate, Action, Effective, HookPoint, Identity, Models, PortSpec, Providers,
};
pub use event::{
    validate_score, Event, GateProvider, GateResult, NoteLevel, Payload, Phase, PrState, Role,
    SpecMode, Verdict,
};
pub use ports::pick_offset;
pub use state::{AgentSnapshot, GateSummary, Health, PrRef, SpecState, TestSummary};
pub use view::{fleet_snapshot, AgentView, FleetRow};

use std::fs::{self, OpenOptions};
use std::io::Write;

use anyhow::{Context, Result};
use chrono::Utc;

/// Append an event to the spec's `events.jsonl` and fold it into `state.json`.
/// Returns the updated snapshot. This is the one write path the producer uses.
pub fn emit(project: &str, name: &str, payload: Payload) -> Result<SpecState> {
    let now = Utc::now();
    let dir = paths::spec_dir(project, name)?;
    fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;

    let event = payload.clone().into_event(paths::source_str(project, name), now);
    let line = serde_json::to_string(&event)?;
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(paths::events_path(project, name)?)?;
    writeln!(f, "{line}")?;

    let state_path = paths::state_path(project, name)?;
    let mut state = if state_path.exists() {
        serde_json::from_str(&fs::read_to_string(&state_path)?)
            .unwrap_or_else(|_| SpecState::new(project.to_string(), name.to_string(), now))
    } else {
        SpecState::new(project.to_string(), name.to_string(), now)
    };
    state.apply(&payload, now);
    fs::write(&state_path, serde_json::to_string_pretty(&state)?)?;
    Ok(state)
}

/// Read one spec's snapshot, if it exists.
pub fn load_state(project: &str, name: &str) -> Result<Option<SpecState>> {
    let p = paths::state_path(project, name)?;
    match fs::read_to_string(&p) {
        Ok(txt) => Ok(serde_json::from_str(&txt).ok()),
        Err(_) => Ok(None),
    }
}

/// Read a spec's full event log (for the detail timeline). Malformed lines are skipped.
pub fn read_events(project: &str, name: &str) -> Result<Vec<Event>> {
    let p = paths::events_path(project, name)?;
    let mut out = Vec::new();
    if let Ok(txt) = fs::read_to_string(&p) {
        for line in txt.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(ev) = serde_json::from_str::<Event>(line) {
                out.push(ev);
            }
        }
    }
    Ok(out)
}

/// Read the spec's design doc (`spec.md`), if the file exists.
pub fn load_spec_doc(project: &str, name: &str) -> Result<Option<String>> {
    let p = paths::spec_doc_path(project, name)?;
    Ok(fs::read_to_string(&p).ok())
}

/// Resolve a project's effective config by walking up from one of its specs'
/// worktrees to the repo `.dex.toml`. `None` when the project has no spec with a
/// resolvable config (e.g. every worktree predates a `.dex.toml`).
pub fn project_config(project: &str) -> Result<Option<Effective>> {
    for s in load_all()?.into_iter().filter(|s| s.project == project) {
        if let Some(wt) = s.worktree {
            if let Ok(Some(eff)) = config::load_effective_opt(std::path::Path::new(&wt)) {
                return Ok(Some(eff));
            }
        }
    }
    Ok(None)
}

/// Read every spec's snapshot across the whole registry.
pub fn load_all() -> Result<Vec<SpecState>> {
    let root = paths::spec_root()?;
    let mut out = Vec::new();
    if !root.exists() {
        return Ok(out);
    }
    for project in fs::read_dir(&root)?.flatten() {
        if !project.path().is_dir() {
            continue;
        }
        for spec in fs::read_dir(project.path())?.flatten() {
            let sp = spec.path().join("state.json");
            if let Ok(txt) = fs::read_to_string(&sp) {
                if let Ok(state) = serde_json::from_str::<SpecState>(&txt) {
                    out.push(state);
                }
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_roundtrips_through_jsonl() {
        let p = Payload::Review {
            round: 2,
            verdict: Verdict::Fail,
            blockers: 1,
            issues: 3,
        };
        let ev = p.into_event("/spec/proj/feat".into(), Utc::now());
        let line = serde_json::to_string(&ev).unwrap();
        let back: Event = serde_json::from_str(&line).unwrap();
        assert_eq!(back.kind, "review.verdict");
        assert_eq!(back.data["blockers"], 1);
        assert_eq!(back.data["verdict"], "fail");
    }

    #[test]
    fn block_is_a_flag_on_the_work_phase() {
        let now = Utc::now();
        let mut s = SpecState::new("proj".into(), "feat".into(), now);
        s.apply(&Payload::PhaseEnter { phase: Phase::Review, reason: None }, now);
        // block does not change the phase — it's a flag.
        s.apply(&Payload::Block { reason: "x".into() }, now);
        assert_eq!(s.phase, Phase::Review);
        assert_eq!(s.blocked_reason.as_deref(), Some("x"));
        assert_eq!(s.health(now, 900), Health::NeedsYou);

        // moving to the next phase clears the block.
        s.apply(&Payload::PhaseEnter { phase: Phase::Ship, reason: None }, now);
        assert_eq!(s.phase, Phase::Ship);
        assert!(s.blocked_reason.is_none());
        // explicit unblock also clears it.
        s.apply(&Payload::Block { reason: "y".into() }, now);
        s.apply(&Payload::Unblock, now);
        assert!(s.blocked_reason.is_none());
    }

    #[test]
    fn init_sets_mode_default_is_autonomous() {
        let now = Utc::now();
        let mut s = SpecState::new("p".into(), "f".into(), now);
        assert_eq!(s.mode, SpecMode::Autonomous);
        s.apply(
            &Payload::Init { branch: "b".into(), worktree: "/wt".into(), mode: SpecMode::Collaborative },
            now,
        );
        assert_eq!(s.mode, SpecMode::Collaborative);
    }

    #[test]
    fn pr_state_folds_into_snapshot() {
        let now = Utc::now();
        let mut s = SpecState::new("p".into(), "f".into(), now);
        s.apply(&Payload::Pr { number: 7, url: "u".into(), state: PrState::Open }, now);
        assert_eq!(s.pr.as_ref().unwrap().state, PrState::Open);
        s.apply(&Payload::Pr { number: 7, url: "u".into(), state: PrState::Merged }, now);
        assert_eq!(s.pr.as_ref().unwrap().state, PrState::Merged);
    }

    #[test]
    fn stale_when_no_heartbeat() {
        let now = Utc::now();
        let mut s = SpecState::new("proj".into(), "feat".into(), now);
        s.apply(&Payload::PhaseEnter { phase: Phase::Build, reason: None }, now);
        let later = now + chrono::Duration::seconds(1000);
        assert_eq!(s.health(later, 900), Health::Stale);
    }
}
