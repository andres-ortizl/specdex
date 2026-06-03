// NOTE: This module depends on Claude Code experimental teams internals:
//   - tmux sockets at /tmp/tmux-<uid>/claude-swarm-<pid>
//   - session named "claude-swarm" inside the socket
//   - teammate processes have --parent-session-id <CLAUDE_CODE_SESSION_ID> in their argv
// If these internals change, all functions degrade gracefully (return None / empty).

use std::path::PathBuf;
use std::process::Command;

/// True if `name` is a claude-swarm tmux socket filename (e.g. "claude-swarm-12345").
pub fn is_swarm_socket_name(name: &str) -> bool {
    name.starts_with("claude-swarm-")
}

/// True if `argv` (the full command-line string for a process) contains
/// `--parent-session-id <session_id>` as an argument (word-boundary match).
pub fn argv_contains_parent_session(argv: &str, session_id: &str) -> bool {
    let needle = format!("--parent-session-id {}", session_id);
    if let Some(pos) = argv.find(&needle) {
        let after = &argv[pos + needle.len()..];
        after.is_empty() || after.starts_with(' ') || after.starts_with('\0')
    } else {
        false
    }
}

#[derive(Debug, Clone)]
pub struct PaneContent {
    pub title: String,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct TeamPanesResult {
    pub socket_name: Option<String>,
    pub panes: Vec<PaneContent>,
}

/// Read all pane contents for the team associated with `session_id`.
/// Returns empty when teams are off, no socket matches, or any I/O fails.
pub fn read_team_panes(session_id: &str) -> TeamPanesResult {
    let Some((socket_name, raw_panes)) = find_socket_for_session(session_id) else {
        return TeamPanesResult { socket_name: None, panes: vec![] };
    };

    let panes = raw_panes
        .into_iter()
        .filter_map(|(pane_id, title)| {
            let text = capture_pane(&socket_name, &pane_id)?;
            Some(PaneContent { title, text })
        })
        .collect();

    TeamPanesResult { socket_name: Some(socket_name), panes }
}

/// argv to open a read-only attach to the swarm socket in the configured terminal.
pub fn watch_team_argv(program: &str, socket_name: &str) -> Vec<String> {
    let safe = socket_name.replace('\'', "'\\''");
    let script = format!("exec tmux -L '{}' attach -r", safe);
    if program == "ghostty" {
        vec![
            "open".into(), "-na".into(), "Ghostty".into(), "--args".into(),
            "-e".into(), "/bin/sh".into(), "-lc".into(), script,
        ]
    } else {
        vec![program.into(), "-e".into(), "/bin/sh".into(), "-lc".into(), script]
    }
}

/// Find the swarm socket name for `session_id` without capturing pane content.
/// Use this when you only need the socket name (e.g. the "watch team" button).
pub fn find_swarm_socket(session_id: &str) -> Option<String> {
    find_socket_for_session(session_id).map(|(name, _)| name)
}

fn find_socket_for_session(session_id: &str) -> Option<(String, Vec<(String, String)>)> {
    for socket_path in list_swarm_sockets() {
        let socket_name = socket_path.file_name()?.to_str()?.to_string();
        if let Some(panes) = match_panes_for_session(&socket_name, session_id) {
            if !panes.is_empty() {
                return Some((socket_name, panes));
            }
        }
    }
    None
}

fn list_swarm_sockets() -> Vec<PathBuf> {
    let Ok(tmp_entries) = std::fs::read_dir("/tmp") else {
        return vec![];
    };
    let mut sockets = vec![];
    for dir_entry in tmp_entries.flatten() {
        let path = dir_entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !dir_name.starts_with("tmux-") {
            continue;
        }
        let Ok(sock_entries) = std::fs::read_dir(&path) else {
            continue;
        };
        for sock in sock_entries.flatten() {
            let name = sock.file_name().to_string_lossy().into_owned();
            if is_swarm_socket_name(&name) {
                sockets.push(sock.path());
            }
        }
    }
    sockets
}

fn match_panes_for_session(socket_name: &str, session_id: &str) -> Option<Vec<(String, String)>> {
    let out = Command::new("tmux")
        .args(["-L", socket_name, "list-panes", "-a", "-F", "#{pane_id}\t#{pane_title}\t#{pane_pid}"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut matched = vec![];
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let (pane_id, title, pid_str) = (parts[0], parts[1], parts[2]);
        let pid = pid_str.trim();
        if pid.is_empty() {
            continue;
        }
        if let Some(argv) = pane_process_argv(pid) {
            if argv_contains_parent_session(&argv, session_id) {
                matched.push((pane_id.to_string(), title.to_string()));
            }
        }
    }
    Some(matched)
}

fn pane_process_argv(pid: &str) -> Option<String> {
    let out = Command::new("ps")
        .args(["-p", pid, "-o", "args="])
        .output()
        .ok()?;
    if out.status.success() && !out.stdout.is_empty() {
        return Some(String::from_utf8_lossy(&out.stdout).trim().to_string());
    }
    // Linux fallback: /proc/<pid>/cmdline uses NUL-separated args
    let cmdline = std::fs::read_to_string(format!("/proc/{pid}/cmdline")).ok()?;
    Some(cmdline.replace('\0', " ").trim().to_string())
}

fn capture_pane(socket_name: &str, pane_id: &str) -> Option<String> {
    let out = Command::new("tmux")
        .args(["-L", socket_name, "capture-pane", "-p", "-t", pane_id])
        .output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_swarm_socket_name_matches_pattern() {
        assert!(is_swarm_socket_name("claude-swarm-12345"));
        assert!(is_swarm_socket_name("claude-swarm-0"));
        assert!(is_swarm_socket_name("claude-swarm-999999"));
    }

    #[test]
    fn is_swarm_socket_name_rejects_non_swarm() {
        assert!(!is_swarm_socket_name("default"));
        assert!(!is_swarm_socket_name("spec-my-feature"));
        assert!(!is_swarm_socket_name("tmux-default"));
        assert!(!is_swarm_socket_name("claude-swarm"));  // no trailing dash + pid
    }

    #[test]
    fn argv_matches_parent_session_mid_string() {
        let argv = "node /usr/local/bin/claude --parent-session-id abc123def --some-flag";
        assert!(argv_contains_parent_session(argv, "abc123def"));
    }

    #[test]
    fn argv_matches_parent_session_at_end() {
        let argv = "claude --parent-session-id abc123";
        assert!(argv_contains_parent_session(argv, "abc123"));
    }

    #[test]
    fn argv_does_not_match_partial_id() {
        let argv = "claude --parent-session-id abc123";
        assert!(!argv_contains_parent_session(argv, "abc"));
        assert!(!argv_contains_parent_session(argv, "bc123"));
    }

    #[test]
    fn argv_does_not_match_when_flag_absent() {
        let argv = "claude --some-flag abc123";
        assert!(!argv_contains_parent_session(argv, "abc123"));
    }

    #[test]
    fn argv_matches_nul_separated_linux_cmdline() {
        // /proc/<pid>/cmdline uses NUL separators; we normalize to spaces before checking
        let cmdline = "claude\0--parent-session-id\0abc123\0--other\0";
        let normalized = cmdline.replace('\0', " ");
        assert!(argv_contains_parent_session(&normalized, "abc123"));
    }

    #[test]
    fn watch_team_argv_ghostty() {
        let argv = watch_team_argv("ghostty", "claude-swarm-12345");
        assert_eq!(argv[..4], ["open", "-na", "Ghostty", "--args"]);
        assert_eq!(argv[7], "exec tmux -L 'claude-swarm-12345' attach -r");
    }

    #[test]
    fn watch_team_argv_other_program() {
        let argv = watch_team_argv("alacritty", "claude-swarm-99");
        assert_eq!(argv[0], "alacritty");
        assert_eq!(argv[4], "exec tmux -L 'claude-swarm-99' attach -r");
    }
}
