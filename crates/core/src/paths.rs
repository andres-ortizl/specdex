//! Layout of the central spec registry at `~/.spec/<project>/<spec>/`.

use std::path::PathBuf;

use anyhow::{anyhow, Result};

pub fn spec_root() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("could not resolve home directory"))?;
    Ok(home.join(".spec"))
}

pub fn spec_dir(project: &str, name: &str) -> Result<PathBuf> {
    Ok(spec_root()?.join(project).join(name))
}

pub fn events_path(project: &str, name: &str) -> Result<PathBuf> {
    Ok(spec_dir(project, name)?.join("events.jsonl"))
}

pub fn state_path(project: &str, name: &str) -> Result<PathBuf> {
    Ok(spec_dir(project, name)?.join("state.json"))
}

pub fn spec_doc_path(project: &str, name: &str) -> Result<PathBuf> {
    Ok(spec_dir(project, name)?.join("spec.md"))
}

pub fn source_str(project: &str, name: &str) -> String {
    format!("/spec/{project}/{name}")
}
