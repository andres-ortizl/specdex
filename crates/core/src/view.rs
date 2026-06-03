//! The fleet view-model: the serializable snapshot the CLI (`dex ls`/`dex watch`)
//! and the desktop app both render. One shape, derived from the per-spec state.

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::state::SpecState;

#[derive(Debug, Clone, Serialize)]
pub struct AgentView {
    pub role: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FleetRow {
    pub project: String,
    pub name: String,
    pub phase: String,
    pub mode: String,
    pub health: String,
    pub agents: Vec<AgentView>,
    pub pr: Option<u64>,
    pub pr_state: Option<String>,
    pub blocked_reason: Option<String>,
    pub review_round: u32,
    pub review_score: Option<u8>,
    pub offset: Option<u16>,
    /// RFC3339 timestamp of the last event — the frontend uses this to decide
    /// whether the life-dot should *breathe* (recent activity) or sit calm. Motion
    /// = real liveness, NOT the health label.
    pub updated_at: String,
}

/// Build the sorted fleet view from raw spec states, deriving health at `now`.
pub fn fleet_snapshot(specs: Vec<SpecState>, now: DateTime<Utc>, stale_secs: i64) -> Vec<FleetRow> {
    let mut rows: Vec<FleetRow> = specs
        .into_iter()
        .map(|s| {
            let health = s.health(now, stale_secs).label().to_string();
            let phase = s.phase.as_str().to_string();
            let mode = s.mode.as_str().to_string();
            let pr = s.pr.as_ref().map(|p| p.number);
            let pr_state = s.pr.as_ref().map(|p| p.state.as_str().to_string());
            let agents = s
                .agents
                .into_iter()
                .map(|a| AgentView { role: a.role, active: a.active })
                .collect();
            FleetRow {
                project: s.project,
                name: s.name,
                phase,
                mode,
                health,
                agents,
                pr,
                pr_state,
                blocked_reason: s.blocked_reason,
                review_round: s.review_round,
                review_score: s.review_score,
                offset: s.offset,
                updated_at: s.updated_at.to_rfc3339(),
            }
        })
        .collect();
    rows.sort_by(|a, b| a.project.cmp(&b.project).then(a.name.cmp(&b.name)));
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::Payload;

    #[test]
    fn snapshot_sorts_and_derives_health() {
        let now = Utc::now();
        let mut blocked = SpecState::new("z-proj".into(), "b".into(), now);
        blocked.apply(&Payload::PhaseEnter { phase: crate::Phase::Review, reason: None }, now);
        blocked.apply(&Payload::Block { reason: "stuck".into() }, now);
        let done = SpecState::new("a-proj".into(), "d".into(), now);
        let rows = fleet_snapshot(vec![blocked, done], now, 900);
        assert_eq!(rows[0].project, "a-proj"); // sorted
        assert_eq!(rows[1].health, "needs-you");
        assert_eq!(rows[1].blocked_reason.as_deref(), Some("stuck"));
    }
}
