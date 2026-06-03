use std::sync::mpsc::channel;

use anyhow::{anyhow, Result};
use chrono::Utc;
use clap::{Parser, Subcommand};
use include_dir::{include_dir, Dir};
use notify::{RecursiveMode, Watcher};
use specdex_core::{
    emit, fleet_snapshot, get_dotted, load_all, load_effective, paths, pick_offset, schema,
    validate, validate_score, GateProvider, GateResult, NoteLevel, Payload, Phase, Role, Verdict,
};

static SKILL_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/../../skill");

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
    /// Stream the fleet snapshot as JSON, re-emitting on every registry change
    Watch,
    /// Inspect merged effective config
    Config {
        #[command(subcommand)]
        op: ConfigOp,
    },
    /// Install specdex agents, skill, and config scaffold into ~/.claude and ~/.config/dex
    Install {
        /// Overwrite the skill even if ~/.claude/skills/specdex already exists (re-sync)
        #[arg(long)]
        update: bool,
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
        Cmd::Watch => return watch(),
        Cmd::Config { ref op } => return config_cmd(op),
        Cmd::Install { ref update } => return install(*update),
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
            // Warn (don't fail) on referenced skills that aren't installed.
            if let Some(home) = dirs::home_dir() {
                let skills = home.join(".claude").join("skills");
                for s in specdex_core::referenced_skills(&eff) {
                    if !skills.join(s.trim_start_matches('/')).exists() {
                        eprintln!("warning: referenced skill {s} not found in ~/.claude/skills");
                    }
                }
            }
            println!("ok");
        }
        ConfigOp::Schema => {
            println!("{}", serde_json::to_string_pretty(&schema())?);
        }
    }
    Ok(())
}

fn install(update: bool) -> Result<()> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("cannot determine home directory"))?;

    let agents_dir = home.join(".claude").join("agents");
    std::fs::create_dir_all(&agents_dir)?;

    let embedded_agents = SKILL_DIR.get_dir("agents").ok_or_else(|| anyhow!("embedded skill/agents/ not found"))?;
    let mut agents_written = 0usize;
    for file in embedded_agents.files() {
        let filename = file.path().file_name().unwrap_or_default();
        let dest = agents_dir.join(filename);
        std::fs::write(&dest, file.contents())?;
        println!("  wrote {}", dest.display());
        agents_written += 1;
    }

    let skill_dest = home.join(".claude").join("skills").join("specdex");
    if skill_dest.exists() && !update {
        println!(
            "warning: ~/.claude/skills/specdex already exists (e.g. a dotfiles symlink) — \
re-run `dex install --update` to overwrite it, or remove it to let specdex manage the skill"
        );
    } else {
        std::fs::create_dir_all(&skill_dest)?;
        if let Some(skill_md) = SKILL_DIR.get_file("SKILL.md") {
            let dest = skill_dest.join("SKILL.md");
            std::fs::write(&dest, skill_md.contents())?;
            println!("  wrote {}", dest.display());
        }
        if let Some(reference_dir) = SKILL_DIR.get_dir("reference") {
            let ref_dest = skill_dest.join("reference");
            std::fs::create_dir_all(&ref_dest)?;
            for file in reference_dir.files() {
                let filename = file.path().file_name().unwrap_or_default();
                let dest = ref_dest.join(filename);
                std::fs::write(&dest, file.contents())?;
                println!("  wrote {}", dest.display());
            }
        }
    }

    // Optional global config — scaffold at the path load_effective reads.
    let config_file = specdex_core::config_path()?;
    if let Some(parent) = config_file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if !config_file.exists() {
        std::fs::write(
            &config_file,
            "# specdex global defaults (optional) — inherited by every project's .dex.toml\n[providers]\nnotifier = \"none\"\n",
        )?;
        println!("  wrote {}", config_file.display());
    } else {
        println!("  skipped {} (already exists)", config_file.display());
    }

    println!();
    println!("install complete — {} agent(s) written to ~/.claude/agents/", agents_written);
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
        Cmd::Ls | Cmd::Watch | Cmd::Config { .. } | Cmd::Ports { .. } | Cmd::Install { .. } => {
            unreachable!("handled before payload build")
        }
    })
}

const STALE_SECS: i64 = 15 * 60;

fn ls() -> Result<()> {
    let rows = fleet_snapshot(load_all()?, Utc::now(), STALE_SECS);
    if rows.is_empty() {
        println!("No specs with state.json yet — run `dex …` from the /spec skill.");
        return Ok(());
    }
    println!("{:<22} {:<28} {:<10} {:<10} PR", "PROJECT", "SPEC", "PHASE", "HEALTH");
    for r in rows {
        let pr = r.pr.map(|n| format!("#{n}")).unwrap_or_default();
        println!(
            "{:<22} {:<28} {:<10} {:<10} {}",
            trunc(&r.project, 22),
            trunc(&r.name, 28),
            r.phase,
            r.health,
            pr
        );
    }
    Ok(())
}

fn print_fleet_json() -> Result<()> {
    let rows = fleet_snapshot(load_all()?, Utc::now(), STALE_SECS);
    println!("{}", serde_json::to_string(&rows)?);
    Ok(())
}

/// Print the fleet snapshot, then re-print on every change under `~/.spec`. This is
/// the exact live feed the desktop app's backend wraps.
fn watch() -> Result<()> {
    print_fleet_json()?;
    let root = paths::spec_root()?;
    if !root.exists() {
        return Ok(());
    }
    let (tx, rx) = channel();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })?;
    watcher.watch(&root, RecursiveMode::Recursive)?;
    while rx.recv().is_ok() {
        while rx.try_recv().is_ok() {} // coalesce a burst of fs events
        print_fleet_json()?;
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
