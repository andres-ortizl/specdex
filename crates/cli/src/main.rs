use anyhow::{anyhow, Result};
use chrono::Utc;
use clap::{Parser, Subcommand};
use specdex_core::{
    emit, get_dotted, load_all, load_effective, pick_offset, schema, validate, validate_score,
    GateProvider, GateResult, NoteLevel, Payload, Phase, Role, Verdict,
};

/// Resource-verb CLI. The target spec is ambient: set `DEX_SPEC=<project>/<name>`
/// once (or pass `-s`). Every write is an event; state is derived.
#[derive(Parser)]
#[command(name = "dex", about = "Spec event substrate — record events, view the fleet")]
struct Cli {
    /// Target spec as <project>/<name> (defaults to $DEX_SPEC)
    #[arg(short, long, global = true, env = "DEX_SPEC")]
    spec: Option<String>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Register the worktree: branch + path (emits spec.created)
    Init {
        #[arg(long)]
        branch: String,
        #[arg(long)]
        worktree: String,
    },
    /// Port allocation
    Ports {
        #[command(subcommand)]
        op: PortsOp,
    },
    /// Set the lifecycle phase (setup|plan|build|review|ship|verify|complete|accepted)
    Phase {
        phase: String,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Flag the spec as blocked on the human
    Block { reason: String },
    /// Clear the blocked flag
    Unblock,
    /// Liveness ping (phase is read from state — no need to repeat it)
    Beat,
    /// Agent activity
    Agent {
        #[command(subcommand)]
        op: AgentOp,
    },
    /// Record a test run
    Test {
        #[arg(long)]
        passed: u32,
        #[arg(long)]
        failed: u32,
        #[arg(long)]
        cmd: Option<String>,
    },
    /// Record a reviewer verdict
    Review {
        #[arg(long)]
        round: u32,
        #[arg(long)]
        verdict: String,
        #[arg(long, default_value_t = 0)]
        blockers: u32,
        #[arg(long, default_value_t = 0)]
        issues: u32,
    },
    /// Record a PR gate outcome (provider: ci|review)
    Gate {
        #[arg(long)]
        provider: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        result: String,
        #[arg(long)]
        score: Option<u8>,
    },
    /// Record the opened PR
    Pr {
        #[arg(long)]
        number: u64,
        #[arg(long)]
        url: String,
    },
    /// Record a freeform observation (the watcher feed)
    Note {
        #[arg(long, default_value = "info")]
        level: String,
        #[arg(long)]
        topic: String,
        #[arg(long)]
        text: String,
    },
    /// List every spec in the fleet with derived health
    Ls,
    /// Inspect merged effective config
    Config {
        #[command(subcommand)]
        op: ConfigOp,
    },
}

#[derive(Subcommand)]
enum ConfigOp {
    /// Print the merged effective config as JSON
    Show,
    /// Print a single dotted key (e.g. providers.notifier, providers.pr_review.reactor)
    Get { key: String },
    /// Validate config and exit nonzero on any violation
    Validate,
    /// Print the machine-readable config surface (valid providers, hooks, phases)
    Schema,
}

#[derive(Subcommand)]
enum PortsOp {
    /// Allocate a free, collision-aware port offset; records it and prints `export` lines
    Alloc,
}

#[derive(Subcommand)]
enum AgentOp {
    /// A teammate started working
    Spawn {
        role: String,
        #[arg(long)]
        id: Option<String>,
    },
    /// A teammate went idle
    Idle { role: String },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Ls => return ls(),
        Cmd::Config { ref op } => return config_cmd(op),
        _ => {}
    }
    let spec = cli
        .spec
        .ok_or_else(|| anyhow!("no target spec — set DEX_SPEC=<project>/<name> or pass -s"))?;
    let (project, name) = split_spec(&spec)?;
    if let Cmd::Ports { op } = cli.cmd {
        return ports_cmd(&project, &name, op);
    }
    let payload = build_payload(cli.cmd)?;
    let state = emit(&project, &name, payload)?;
    println!("{spec} → {}", state.phase.as_str());
    Ok(())
}

fn ports_cmd(project: &str, name: &str, op: PortsOp) -> Result<()> {
    match op {
        PortsOp::Alloc => {
            let eff = load_effective(&std::env::current_dir()?)?;
            if eff.ports.is_empty() {
                eprintln!("# no [ports] configured for this project");
                return Ok(());
            }
            let used = used_offsets(project, name)?;
            let (offset, map) = pick_offset(&eff.ports, &used, 10, 990, port_is_free)
                .ok_or_else(|| anyhow!("no free port offset found up to 990"))?;
            emit(project, name, Payload::PortsAssigned { offset, ports: map.clone() })?;
            for ps in &eff.ports {
                if let Some(p) = map.get(&ps.service) {
                    println!("export {}={}", ps.env, p);
                }
            }
            Ok(())
        }
    }
}

/// Offsets reserved by other active (non-terminal) specs across the whole registry.
fn used_offsets(self_project: &str, self_name: &str) -> Result<Vec<u16>> {
    Ok(load_all()?
        .into_iter()
        .filter(|s| !(s.project == self_project && s.name == self_name))
        .filter(|s| !s.phase.is_terminal())
        .filter_map(|s| s.offset)
        .collect())
}

fn port_is_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn config_cmd(op: &ConfigOp) -> Result<()> {
    let cwd = std::env::current_dir()?;
    match op {
        ConfigOp::Show => {
            let eff = load_effective(&cwd)?;
            println!("{}", serde_json::to_string_pretty(&eff)?);
        }
        ConfigOp::Get { key } => {
            let eff = load_effective(&cwd)?;
            println!("{}", get_dotted(&eff, key)?);
        }
        ConfigOp::Validate => {
            let eff = load_effective(&cwd)?;
            validate(&eff)?;
            println!("ok");
        }
        ConfigOp::Schema => {
            println!("{}", serde_json::to_string_pretty(&schema())?);
        }
    }
    Ok(())
}

fn build_payload(cmd: Cmd) -> Result<Payload> {
    Ok(match cmd {
        Cmd::Init { branch, worktree } => Payload::Init { branch, worktree },
        Cmd::Phase { phase, reason } => Payload::PhaseEnter { phase: parse_phase(&phase)?, reason },
        Cmd::Block { reason } => Payload::Block { reason },
        Cmd::Unblock => Payload::Unblock,
        Cmd::Beat => Payload::Heartbeat,
        Cmd::Agent { op } => match op {
            AgentOp::Spawn { role, id } => {
                Payload::AgentSpawn { role: parse_role(&role)?, agent_id: id }
            }
            AgentOp::Idle { role } => Payload::AgentIdle { role: parse_role(&role)? },
        },
        Cmd::Test { passed, failed, cmd } => Payload::Test { passed, failed, cmd },
        Cmd::Review { round, verdict, blockers, issues } => {
            Payload::Review { round, verdict: parse_verdict(&verdict)?, blockers, issues }
        }
        Cmd::Gate { provider, name, result, score } => {
            let score = match score {
                Some(s) => {
                    Some(validate_score(s).ok_or_else(|| anyhow!("score must be 0–5, got {s}"))?)
                }
                None => None,
            };
            Payload::Gate {
                provider: parse_gate_provider(&provider)?,
                name,
                result: parse_gate_result(&result)?,
                score,
            }
        }
        Cmd::Pr { number, url } => Payload::Pr { number, url },
        Cmd::Note { level, topic, text } => {
            Payload::Note { level: parse_level(&level)?, topic, text }
        }
        Cmd::Ls | Cmd::Config { .. } | Cmd::Ports { .. } => {
            unreachable!("handled before payload build")
        }
    })
}

fn ls() -> Result<()> {
    let now = Utc::now();
    let mut specs = load_all()?;
    specs.sort_by(|a, b| a.project.cmp(&b.project).then(a.name.cmp(&b.name)));
    if specs.is_empty() {
        println!("No specs with state.json yet — run `dex …` from the /spec skill.");
        return Ok(());
    }
    println!("{:<22} {:<28} {:<10} {:<10} PR", "PROJECT", "SPEC", "PHASE", "HEALTH");
    for s in specs {
        let health = s.health(now, 15 * 60);
        let pr = s.pr.as_ref().map(|p| format!("#{}", p.number)).unwrap_or_default();
        println!(
            "{:<22} {:<28} {:<10} {:<10} {}",
            trunc(&s.project, 22),
            trunc(&s.name, 28),
            s.phase.as_str(),
            health.label(),
            pr
        );
    }
    Ok(())
}

fn split_spec(s: &str) -> Result<(String, String)> {
    let (p, n) = s
        .split_once('/')
        .ok_or_else(|| anyhow!("--spec must be <project>/<name>, got {s:?}"))?;
    Ok((p.to_string(), n.to_string()))
}

fn parse_phase(s: &str) -> Result<Phase> {
    Ok(match s {
        "setup" => Phase::Setup,
        "plan" => Phase::Plan,
        "build" => Phase::Build,
        "review" => Phase::Review,
        "ship" => Phase::Ship,
        "verify" => Phase::Verify,
        "complete" => Phase::Complete,
        "accepted" => Phase::Accepted,
        o => return Err(anyhow!("unknown phase: {o}")),
    })
}

fn parse_role(s: &str) -> Result<Role> {
    Ok(match s {
        "lead" => Role::Lead,
        "coder" => Role::Coder,
        "reviewer" => Role::Reviewer,
        o => return Err(anyhow!("unknown role: {o}")),
    })
}

fn parse_verdict(s: &str) -> Result<Verdict> {
    Ok(match s {
        "pass" => Verdict::Pass,
        "fail" => Verdict::Fail,
        "pass_with_notes" | "notes" => Verdict::PassWithNotes,
        o => return Err(anyhow!("unknown verdict: {o}")),
    })
}

fn parse_gate_provider(s: &str) -> Result<GateProvider> {
    Ok(match s {
        "ci" => GateProvider::Ci,
        "review" => GateProvider::Review,
        o => return Err(anyhow!("unknown gate provider: {o} (expected ci|review)")),
    })
}

fn parse_gate_result(s: &str) -> Result<GateResult> {
    Ok(match s {
        "success" => GateResult::Success,
        "failure" => GateResult::Failure,
        "cancelled" => GateResult::Cancelled,
        "skipped" => GateResult::Skipped,
        "timed_out" => GateResult::TimedOut,
        "neutral" => GateResult::Neutral,
        "pending" => GateResult::Pending,
        o => return Err(anyhow!("unknown gate result: {o}")),
    })
}

fn parse_level(s: &str) -> Result<NoteLevel> {
    Ok(match s {
        "info" => NoteLevel::Info,
        "warn" => NoteLevel::Warn,
        "error" => NoteLevel::Error,
        o => return Err(anyhow!("unknown note level: {o}")),
    })
}

fn trunc(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max - 1])
    }
}
