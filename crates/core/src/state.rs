//! The derived snapshot. `state.json` is the last-known state of a spec, rewritten
//! on every event so the fleet view is a single cheap read per spec — no log scan.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::event::{Payload, Phase, Ports};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSnapshot {
    pub role: String,
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub since: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrRef {
    pub number: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestSummary {
    pub passed: u32,
    pub failed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateSummary {
    pub provider: String,
    pub result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecState {
    pub project: String,
    pub name: String,
    pub phase: Phase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ports: Option<Ports>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr: Option<PrRef>,
    #[serde(default)]
    pub review_round: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_score: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_test: Option<TestSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_gate: Option<GateSummary>,
    #[serde(default)]
    pub agents: Vec<AgentSnapshot>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_heartbeat: Option<DateTime<Utc>>,
}

impl SpecState {
    pub fn new(project: String, name: String, now: DateTime<Utc>) -> Self {
        SpecState {
            project,
            name,
            phase: Phase::Setup,
            branch: None,
            worktree: None,
            ports: None,
            pr: None,
            review_round: 0,
            review_score: None,
            blocked_reason: None,
            last_test: None,
            last_gate: None,
            agents: Vec::new(),
            created_at: now,
            updated_at: now,
            last_heartbeat: None,
        }
    }

    pub fn apply(&mut self, p: &Payload, now: DateTime<Utc>) {
        self.updated_at = now;
        match p {
            Payload::Init { branch, worktree, ports } => {
                self.branch = Some(branch.clone());
                self.worktree = Some(worktree.clone());
                self.ports = Some(*ports);
            }
            Payload::PhaseEnter { phase, .. } => {
                self.phase = *phase;
                self.blocked_reason = None; // moving on clears any block
            }
            Payload::Block { reason } => {
                self.blocked_reason = Some(reason.clone());
            }
            Payload::Unblock => {
                self.blocked_reason = None;
            }
            Payload::Heartbeat => {
                self.last_heartbeat = Some(now);
            }
            Payload::AgentSpawn { role, agent_id } => {
                self.set_agent(role.as_str(), true, agent_id.clone(), now);
            }
            Payload::AgentIdle { role } => {
                self.set_agent(role.as_str(), false, None, now);
            }
            Payload::Test { passed, failed, .. } => {
                self.last_test = Some(TestSummary { passed: *passed, failed: *failed });
            }
            Payload::Review { round, .. } => {
                self.review_round = *round;
            }
            Payload::Gate { provider, result, score, .. } => {
                self.last_gate = Some(GateSummary {
                    provider: provider.as_str().to_string(),
                    result: result.as_str().to_string(),
                });
                if let Some(s) = score {
                    self.review_score = Some(*s);
                }
            }
            Payload::Pr { number, url } => {
                self.pr = Some(PrRef { number: *number, url: url.clone() });
            }
            Payload::Note { .. } => {} // notes are append-only telemetry; no state fold
        }
    }

    fn set_agent(&mut self, role: &str, active: bool, agent_id: Option<String>, now: DateTime<Utc>) {
        if let Some(a) = self.agents.iter_mut().find(|a| a.role == role) {
            a.active = active;
            if agent_id.is_some() {
                a.agent_id = agent_id;
            }
            a.since = now;
        } else {
            self.agents.push(AgentSnapshot { role: role.to_string(), active, agent_id, since: now });
        }
    }

    /// Liveness, derived rather than stored. `stale_after_secs` is how long a
    /// non-terminal spec can go without a heartbeat (or any event) before it's
    /// assumed stuck.
    pub fn health(&self, now: DateTime<Utc>, stale_after_secs: i64) -> Health {
        if self.phase.is_terminal() {
            return Health::Done;
        }
        if self.blocked_reason.is_some() {
            return Health::NeedsYou;
        }
        let last = self.last_heartbeat.unwrap_or(self.updated_at);
        if (now - last).num_seconds() > stale_after_secs {
            return Health::Stale;
        }
        if self.agents.iter().any(|a| a.active) {
            Health::Alive
        } else {
            Health::Idle
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Health {
    Done,
    NeedsYou,
    Stale,
    Alive,
    Idle,
}

impl Health {
    pub fn label(self) -> &'static str {
        match self {
            Health::Done => "done",
            Health::NeedsYou => "needs-you",
            Health::Stale => "stale",
            Health::Alive => "alive",
            Health::Idle => "idle",
        }
    }
}
