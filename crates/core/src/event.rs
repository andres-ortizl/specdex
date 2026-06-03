//! The event vocabulary — the single contract shared by the producer (`dex`,
//! called from the /spec skill) and every consumer (CLI, future desktop app).
//!
//! Wire shape is CloudEvents-flavored (`type`, `time`, `source`, `subject`, `data`)
//! but the `data` payload is domain-specific. The substrate is vendor-agnostic: it
//! never names Greptile, Slack, or a specific CI — it records generic facts (a
//! `verify` phase, a `gate` from provider `ci` or `review`). Which concrete tool
//! fulfills each role is config, consumed by the skill, not the substrate.
//!
//! Everything is an event; state is always derived, never set directly. There is
//! one operation — record an event — and the variety is the event type.
//!
//! Phases are sequential and non-overlapping, so a `phase.enter` implicitly ends
//! the previous phase. `block` is a flag layered on the current phase, not a phase.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The lifecycle state machine. Generic activities, no vendor names. A vault may
/// disable phases (e.g. personal specs skip `verify`) but the vocabulary is fixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Setup,
    Plan,
    Build,
    Review,
    Ship,
    Verify,
    Complete,
    Accepted,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Setup => "setup",
            Phase::Plan => "plan",
            Phase::Build => "build",
            Phase::Review => "review",
            Phase::Ship => "ship",
            Phase::Verify => "verify",
            Phase::Complete => "complete",
            Phase::Accepted => "accepted",
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Phase::Complete | Phase::Accepted)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Lead,
    Coder,
    Reviewer,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Lead => "lead",
            Role::Coder => "coder",
            Role::Reviewer => "reviewer",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Pass,
    Fail,
    PassWithNotes,
}

/// A generic PR gate — the substrate doesn't know CI vs Greptile by vendor, only
/// by role. Config maps `ci` → github-actions, `review` → greptile, etc.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateProvider {
    Ci,
    Review,
}

impl GateProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            GateProvider::Ci => "ci",
            GateProvider::Review => "review",
        }
    }
}

/// Generic gate outcome — covers both CI conclusions and review outcomes. A skill
/// maps a vendor-specific status (GitHub's `timed_out`, etc.) onto these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateResult {
    Success,
    Failure,
    Cancelled,
    Skipped,
    TimedOut,
    Neutral,
    Pending,
}

impl GateResult {
    pub fn as_str(self) -> &'static str {
        match self {
            GateResult::Success => "success",
            GateResult::Failure => "failure",
            GateResult::Cancelled => "cancelled",
            GateResult::Skipped => "skipped",
            GateResult::TimedOut => "timed_out",
            GateResult::Neutral => "neutral",
            GateResult::Pending => "pending",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteLevel {
    Info,
    Warn,
    Error,
}

/// Greptile-style review scores are 0–5. Returns `None` on an out-of-range value.
pub fn validate_score(s: u8) -> Option<u8> {
    (s <= 5).then_some(s)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Ports {
    pub offset: u16,
    pub frontend: u16,
    pub backend: u16,
    pub api: u16,
    pub postgres: u16,
}

impl Ports {
    pub fn from_offset(offset: u16) -> Self {
        Ports {
            offset,
            frontend: 5173 + offset,
            backend: 8080 + offset,
            api: 8081 + offset,
            postgres: 5432 + offset,
        }
    }
}

/// The on-disk wire event (one JSON object per line in `events.jsonl`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    #[serde(rename = "type")]
    pub kind: String,
    pub time: DateTime<Utc>,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub data: Value,
}

/// The typed producer side. Each variant maps to one `type` string and renders its
/// own `data`. This is what the CLI builds from args.
#[derive(Debug, Clone)]
pub enum Payload {
    Init { branch: String, worktree: String, ports: Ports },
    PhaseEnter { phase: Phase, reason: Option<String> },
    Block { reason: String },
    Unblock,
    Heartbeat,
    AgentSpawn { role: Role, agent_id: Option<String> },
    AgentIdle { role: Role },
    Test { passed: u32, failed: u32, cmd: Option<String> },
    Review { round: u32, verdict: Verdict, blockers: u32, issues: u32 },
    Gate { provider: GateProvider, name: Option<String>, result: GateResult, score: Option<u8> },
    Pr { number: u64, url: String },
    Note { level: NoteLevel, topic: String, text: String },
}

impl Payload {
    pub fn kind(&self) -> &'static str {
        match self {
            Payload::Init { .. } => "spec.created",
            Payload::PhaseEnter { .. } => "phase.enter",
            Payload::Block { .. } => "spec.blocked",
            Payload::Unblock => "spec.unblocked",
            Payload::Heartbeat => "heartbeat",
            Payload::AgentSpawn { .. } => "agent.spawn",
            Payload::AgentIdle { .. } => "agent.idle",
            Payload::Test { .. } => "test.result",
            Payload::Review { .. } => "review.verdict",
            Payload::Gate { .. } => "gate.status",
            Payload::Pr { .. } => "pr.created",
            Payload::Note { .. } => "note",
        }
    }

    pub fn subject(&self) -> Option<String> {
        match self {
            Payload::AgentSpawn { role, .. } | Payload::AgentIdle { role } => {
                Some(role.as_str().to_string())
            }
            Payload::Gate { provider, .. } => Some(provider.as_str().to_string()),
            _ => None,
        }
    }

    pub fn data(&self) -> Value {
        match self {
            Payload::Init { branch, worktree, ports } => {
                json!({ "branch": branch, "worktree": worktree, "ports": ports })
            }
            Payload::PhaseEnter { phase, reason } => {
                let mut m = json!({ "phase": phase });
                if let Some(r) = reason {
                    m["reason"] = json!(r);
                }
                m
            }
            Payload::Block { reason } => json!({ "reason": reason }),
            Payload::Unblock => Value::Null,
            Payload::Heartbeat => Value::Null,
            Payload::AgentSpawn { role, agent_id } => json!({ "role": role, "agent_id": agent_id }),
            Payload::AgentIdle { role } => json!({ "role": role }),
            Payload::Test { passed, failed, cmd } => {
                json!({ "passed": passed, "failed": failed, "cmd": cmd })
            }
            Payload::Review { round, verdict, blockers, issues } => {
                json!({ "round": round, "verdict": verdict, "blockers": blockers, "issues": issues })
            }
            Payload::Gate { provider, name, result, score } => {
                json!({ "provider": provider, "name": name, "result": result, "score": score })
            }
            Payload::Pr { number, url } => json!({ "number": number, "url": url }),
            Payload::Note { level, topic, text } => {
                json!({ "level": level, "topic": topic, "text": text })
            }
        }
    }

    pub fn into_event(self, source: String, time: DateTime<Utc>) -> Event {
        Event {
            kind: self.kind().to_string(),
            time,
            source,
            subject: self.subject(),
            data: self.data(),
        }
    }
}
