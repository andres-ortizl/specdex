use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json;

pub struct ProviderDef {
    pub role: &'static str,
    pub reactor: Option<&'static str>,
}

const REGISTRY: &[(&str, ProviderDef)] = &[
    ("slack", ProviderDef { role: "notifier", reactor: None }),
    ("discord", ProviderDef { role: "notifier", reactor: None }),
    ("none", ProviderDef { role: "notifier", reactor: None }),
    ("github-actions", ProviderDef { role: "ci", reactor: Some("/react-to-pipelines") }),
    ("none", ProviderDef { role: "ci", reactor: None }),
    ("greptile", ProviderDef { role: "pr_review", reactor: Some("/react-to-greptile") }),
    ("coderabbit", ProviderDef { role: "pr_review", reactor: Some("/react-to-coderabbit") }),
    ("none", ProviderDef { role: "pr_review", reactor: None }),
];

fn lookup(role: &str, name: &str) -> Option<&'static ProviderDef> {
    REGISTRY.iter().find(|(n, d)| *n == name && d.role == role).map(|(_, d)| d)
}

pub fn reactor_for(role: &str, name: &str) -> Option<&'static str> {
    lookup(role, name).and_then(|d| d.reactor)
}

fn valid_for_role(role: &str, name: &str) -> bool {
    lookup(role, name).is_some()
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookPoint {
    OnShip,
    OnVerifyCi,
    OnVerifyReview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    Skill { r#ref: String },
}

impl<'de> Deserialize<'de> for Action {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Short(String),
            Long { kind: String, r#ref: String },
        }
        match Raw::deserialize(d)? {
            Raw::Short(s) => Ok(Action::Skill { r#ref: s }),
            Raw::Long { kind, r#ref } if kind == "skill" => Ok(Action::Skill { r#ref }),
            Raw::Long { kind, .. } => Err(serde::de::Error::custom(format!("unknown action kind: {kind}"))),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Providers {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notifier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ci: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_review: Option<String>,
}

/// A service this project runs locally and the env var its allocated port exports as.
/// Generic — no anyformat/web assumptions; a CLI project simply declares none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortSpec {
    pub service: String,
    pub base: u16,
    pub env: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Identity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_org: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Effective {
    #[serde(default)]
    pub providers: Providers,
    #[serde(default)]
    pub hooks: BTreeMap<HookPoint, Action>,
    #[serde(default)]
    pub phases_skip: Vec<String>,
    #[serde(default)]
    pub ports: Vec<PortSpec>,
    #[serde(default)]
    pub identity: Identity,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Layer {
    #[serde(default)]
    providers: Providers,
    #[serde(default)]
    hooks: BTreeMap<HookPoint, Action>,
    #[serde(default)]
    phases: PhasesLayer,
    #[serde(default)]
    ports: Vec<PortSpec>,
    #[serde(default)]
    identity: Identity,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct PhasesLayer {
    #[serde(default)]
    skip: Vec<String>,
}

fn merge(base: Effective, over: Layer) -> Effective {
    Effective {
        providers: Providers {
            notifier: over.providers.notifier.or(base.providers.notifier),
            ci: over.providers.ci.or(base.providers.ci),
            pr_review: over.providers.pr_review.or(base.providers.pr_review),
        },
        hooks: {
            let mut h = base.hooks;
            h.extend(over.hooks);
            h
        },
        phases_skip: if !over.phases.skip.is_empty() {
            over.phases.skip
        } else {
            base.phases_skip
        },
        ports: if !over.ports.is_empty() { over.ports } else { base.ports },
        identity: Identity {
            env_file: over.identity.env_file.or(base.identity.env_file),
            github_org: over.identity.github_org.or(base.identity.github_org),
        },
    }
}

const VALID_PHASES: &[&str] =
    &["setup", "plan", "build", "review", "ship", "verify", "complete", "accepted"];

pub fn validate(eff: &Effective) -> Result<()> {
    if let Some(n) = &eff.providers.notifier {
        if !valid_for_role("notifier", n) {
            return Err(anyhow!("unknown notifier provider: {n}"));
        }
    }
    if let Some(n) = &eff.providers.ci {
        if !valid_for_role("ci", n) {
            return Err(anyhow!("unknown ci provider: {n}"));
        }
    }
    if let Some(n) = &eff.providers.pr_review {
        if !valid_for_role("pr_review", n) {
            return Err(anyhow!("unknown pr_review provider: {n}"));
        }
    }
    for p in &eff.phases_skip {
        if !VALID_PHASES.contains(&p.as_str()) {
            return Err(anyhow!("invalid phases_skip entry: {p}"));
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    for p in &eff.ports {
        if !seen.insert(&p.service) {
            return Err(anyhow!("duplicate port service: {}", p.service));
        }
    }
    Ok(())
}

fn merge_layers(layers: Vec<Layer>) -> Effective {
    layers.into_iter().fold(Effective::default(), merge)
}

fn find_project_file(cwd: &Path) -> Option<PathBuf> {
    let mut dir = cwd;
    loop {
        let candidate = dir.join(".dex.toml");
        if candidate.exists() {
            return Some(candidate);
        }
        dir = dir.parent()?;
    }
}

/// The optional global personal config: machine-wide defaults (notifier, identity)
/// inherited by every project. Single source of truth shared by the loader and
/// `dex install` so the scaffold lands where `load_effective` looks.
pub fn config_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("could not resolve home directory"))?;
    Ok(home.join(".config").join("dex").join("config.toml"))
}

fn parse_layer_file(path: &Path) -> Result<Layer> {
    let text = std::fs::read_to_string(path)?;
    toml::from_str(&text).map_err(|e| anyhow!("parsing {}: {e}", path.display()))
}

/// Resolve effective config: built-in defaults ← `~/.config/dex/config.toml`
/// (optional global) ← `<repo>/.dex.toml` (project, primary).
pub fn load_effective(cwd: &Path) -> Result<Effective> {
    let mut layers: Vec<Layer> = Vec::new();
    if let Ok(global) = config_path() {
        if global.exists() {
            layers.push(parse_layer_file(&global)?);
        }
    }
    if let Some(project) = find_project_file(cwd) {
        layers.push(parse_layer_file(&project)?);
    }
    let eff = merge_layers(layers);
    validate(&eff)?;
    Ok(eff)
}

/// Skill refs this config points at (hook actions + provider reactors) — used to
/// warn when a referenced skill isn't installed.
pub fn referenced_skills(eff: &Effective) -> Vec<String> {
    let mut out = Vec::new();
    for action in eff.hooks.values() {
        let Action::Skill { r#ref } = action;
        out.push(r#ref.clone());
    }
    for (role, name) in [("ci", &eff.providers.ci), ("pr_review", &eff.providers.pr_review)] {
        if let Some(n) = name {
            if let Some(r) = reactor_for(role, n) {
                out.push(r.to_string());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

pub fn get_dotted(eff: &Effective, key: &str) -> Result<String> {
    match key {
        "providers.notifier" => Ok(eff.providers.notifier.clone().unwrap_or_default()),
        "providers.ci" => Ok(eff.providers.ci.clone().unwrap_or_default()),
        "providers.pr_review" => Ok(eff.providers.pr_review.clone().unwrap_or_default()),
        "providers.pr_review.reactor" => {
            let name = eff.providers.pr_review.as_deref().unwrap_or("none");
            Ok(reactor_for("pr_review", name).unwrap_or("").to_string())
        }
        "providers.ci.reactor" => {
            let name = eff.providers.ci.as_deref().unwrap_or("none");
            Ok(reactor_for("ci", name).unwrap_or("").to_string())
        }
        "hooks.on_ship" => match eff.hooks.get(&HookPoint::OnShip) {
            Some(Action::Skill { r#ref }) => Ok(r#ref.clone()),
            None => Ok(String::new()),
        },
        "hooks.on_verify_ci" => match eff.hooks.get(&HookPoint::OnVerifyCi) {
            Some(Action::Skill { r#ref }) => Ok(r#ref.clone()),
            None => Ok(String::new()),
        },
        "hooks.on_verify_review" => match eff.hooks.get(&HookPoint::OnVerifyReview) {
            Some(Action::Skill { r#ref }) => Ok(r#ref.clone()),
            None => Ok(String::new()),
        },
        "phases_skip" => Ok(serde_json::to_string(&eff.phases_skip)?),
        "ports" => Ok(serde_json::to_string(&eff.ports)?),
        "identity.env_file" => Ok(eff.identity.env_file.clone().unwrap_or_default()),
        "identity.github_org" => Ok(eff.identity.github_org.clone().unwrap_or_default()),
        _ => Err(anyhow!("unknown config key: {key}")),
    }
}

/// Machine-readable description of the config surface, sourced from the live
/// REGISTRY + enums (NOT the struct types — the "which providers are valid per
/// role" constraint lives in the registry, which a type-derived JSON Schema can't
/// express). Consumed by `/spec configure` for LLM self-configuration and by humans.
pub fn schema() -> serde_json::Value {
    use serde_json::json;
    let mut providers = serde_json::Map::new();
    for role in ["notifier", "ci", "pr_review"] {
        let valid: Vec<&str> =
            REGISTRY.iter().filter(|(_, d)| d.role == role).map(|(n, _)| *n).collect();
        let reactors: serde_json::Map<String, serde_json::Value> = REGISTRY
            .iter()
            .filter(|(_, d)| d.role == role)
            .filter_map(|(n, d)| d.reactor.map(|r| (n.to_string(), json!(r))))
            .collect();
        providers.insert(role.to_string(), json!({ "valid": valid, "reactors": reactors }));
    }
    json!({
        "providers": providers,
        "hooks": {
            "points": ["on_ship", "on_verify_ci", "on_verify_review"],
            "value": "a skill ref string (e.g. \"/pr\") or { kind = \"skill\", ref = \"/pr\" }"
        },
        "phases_skip": { "valid": VALID_PHASES },
        "ports": {
            "shape": "array of { service, base, env } tables ([[ports]])",
            "note": "service = logical name; base = base port; env = env var the allocated port exports as. A CLI project declares none."
        },
        "identity": { "fields": ["env_file", "github_org"] },
        "authoring": {
            "format": "toml",
            "project_file": ".dex.toml at repo root (primary config)",
            "global_file": "~/.config/dex/config.toml (optional personal defaults)",
            "merge": "defaults <- ~/.config/dex/config.toml <- project (higher overrides per field)"
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_layer(s: &str) -> Layer {
        toml::from_str(s).expect("parse layer")
    }

    fn effective_with_phases_skip(phases: Vec<String>) -> Effective {
        Effective { phases_skip: phases, ..Effective::default() }
    }

    #[test]
    fn merge_precedence_project_over_vault_over_default() {
        let vault = parse_layer(r#"
            [providers]
            notifier = "slack"
            ci = "github-actions"
        "#);
        let project = parse_layer(r#"
            [providers]
            notifier = "discord"
        "#);
        let eff = merge_layers(vec![vault, project]);
        assert_eq!(eff.providers.notifier.as_deref(), Some("discord"));
        assert_eq!(eff.providers.ci.as_deref(), Some("github-actions"));
    }

    #[test]
    fn reactor_resolved_from_registry_not_toml() {
        let layer = parse_layer(r#"
            [providers]
            pr_review = "greptile"
        "#);
        let eff = merge_layers(vec![layer]);
        let reactor = reactor_for("pr_review", eff.providers.pr_review.as_deref().unwrap());
        assert_eq!(reactor, Some("/react-to-greptile"));
    }

    #[test]
    fn coderabbit_reactor() {
        assert_eq!(reactor_for("pr_review", "coderabbit"), Some("/react-to-coderabbit"));
    }

    #[test]
    fn github_actions_reactor() {
        assert_eq!(reactor_for("ci", "github-actions"), Some("/react-to-pipelines"));
    }

    #[test]
    fn phases_skip_deserialized() {
        let layer = parse_layer(r#"
            [phases]
            skip = ["verify"]
        "#);
        let eff = merge_layers(vec![layer]);
        assert_eq!(eff.phases_skip, vec!["verify"]);
    }

    #[test]
    fn unknown_provider_fails_validation() {
        let layer = parse_layer(r#"
            [providers]
            pr_review = "acme"
        "#);
        let eff = merge_layers(vec![layer]);
        let err = validate(&eff).unwrap_err();
        assert!(err.to_string().contains("unknown pr_review provider: acme"), "{err}");
    }

    #[test]
    fn on_ship_string_shorthand_deserializes_to_skill() {
        let layer = parse_layer(r#"
            [hooks]
            on_ship = "/pr"
        "#);
        let eff = merge_layers(vec![layer]);
        assert_eq!(eff.hooks.get(&HookPoint::OnShip), Some(&Action::Skill { r#ref: "/pr".into() }));
    }

    #[test]
    fn on_ship_long_form_also_works() {
        let layer = parse_layer(r#"
            [hooks.on_ship]
            kind = "skill"
            ref = "/pr"
        "#);
        let eff = merge_layers(vec![layer]);
        assert_eq!(eff.hooks.get(&HookPoint::OnShip), Some(&Action::Skill { r#ref: "/pr".into() }));
    }

    #[test]
    fn get_dotted_reactor() {
        let layer = parse_layer(r#"
            [providers]
            pr_review = "greptile"
        "#);
        let eff = merge_layers(vec![layer]);
        let val = get_dotted(&eff, "providers.pr_review.reactor").unwrap();
        assert_eq!(val, "/react-to-greptile");
    }

    #[test]
    fn get_dotted_phases_skip_json() {
        let layer = parse_layer(r#"
            [phases]
            skip = ["verify"]
        "#);
        let eff = merge_layers(vec![layer]);
        let val = get_dotted(&eff, "phases_skip").unwrap();
        assert_eq!(val, r#"["verify"]"#);
    }

    #[test]
    fn validate_rejects_invalid_phases_skip_entry() {
        let eff = effective_with_phases_skip(vec!["bogus".to_string()]);
        let err = validate(&eff).unwrap_err();
        assert!(err.to_string().contains("invalid phases_skip entry: bogus"), "{err}");
    }

    #[test]
    fn get_dotted_hooks_on_ship() {
        let layer = parse_layer(r#"
            [hooks]
            on_ship = "/pr"
        "#);
        let eff = merge_layers(vec![layer]);
        let val = get_dotted(&eff, "hooks.on_ship").unwrap();
        assert_eq!(val, "/pr");
    }

    #[test]
    fn unknown_notifier_fails_validation() {
        let layer = parse_layer(r#"
            [providers]
            notifier = "teams"
        "#);
        let eff = merge_layers(vec![layer]);
        let err = validate(&eff).unwrap_err();
        assert!(err.to_string().contains("unknown notifier provider: teams"), "{err}");
    }

    #[test]
    fn valid_config_passes_validation() {
        let layer = parse_layer(r#"
            [providers]
            notifier = "slack"
            ci = "github-actions"
            pr_review = "greptile"

            [hooks]
            on_ship = "/pr"

            [phases]
            skip = ["verify"]
        "#);
        let eff = merge_layers(vec![layer]);
        assert!(validate(&eff).is_ok());
    }

    #[test]
    fn schema_is_registry_sourced() {
        let s = schema();
        let pr = &s["providers"]["pr_review"];
        let valid: Vec<&str> = pr["valid"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert!(valid.contains(&"greptile") && valid.contains(&"coderabbit"));
        assert_eq!(pr["reactors"]["greptile"], "/react-to-greptile");
        assert_eq!(s["phases_skip"]["valid"].as_array().unwrap().len(), 8);
        assert!(s["hooks"]["points"].as_array().unwrap().iter().any(|v| v == "on_ship"));
    }

    #[test]
    fn hooks_merge_additive() {
        let vault = parse_layer(r#"
            [hooks]
            on_ship = "/pr"
        "#);
        let project = parse_layer(r#"
            [hooks]
            on_verify_ci = "/wait-for-ci"
        "#);
        let eff = merge_layers(vec![vault, project]);
        assert!(eff.hooks.contains_key(&HookPoint::OnShip));
        assert!(eff.hooks.contains_key(&HookPoint::OnVerifyCi));
    }
}
