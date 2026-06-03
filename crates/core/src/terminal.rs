fn sq_escape(s: &str) -> String {
    s.replace('\'', "'\\''")
}

pub fn attach_argv(
    program: &str,
    mux: Option<&str>,
    session: &str,
    worktree: Option<&str>,
    session_id: Option<&str>,
) -> Vec<String> {
    let claude_cmd = match session_id {
        Some(id) => format!("claude --resume '{}'", sq_escape(id)),
        None => "claude --continue".to_string(),
    };

    let script = match mux {
        Some("tmux") => {
            let cwd = worktree
                .map(|wt| format!(" -c '{}'", sq_escape(wt)))
                .unwrap_or_default();
            format!(
                "exec tmux new-session -A -s '{}'{} '{}'",
                sq_escape(session),
                cwd,
                sq_escape(&claude_cmd)
            )
        }
        Some("zellij") => {
            // zellij has no one-flag attach-or-create-with-command.
            // Verified (0.44.x): `zellij --session NAME run` fails when NAME is absent.
            // Three-step create branch: (1) create background session,
            // (2) run claude in it, (3) attach so the user sees it.
            let cwd = worktree
                .map(|wt| format!(" --cwd '{}'", sq_escape(wt)))
                .unwrap_or_default();
            let s = sq_escape(session);
            format!(
                "zellij attach '{s}' 2>/dev/null || {{ zellij attach -b -c '{s}' && zellij --session '{s}' run{cwd} -- {claude_cmd} && exec zellij attach '{s}'; }}"
            )
        }
        _ => {
            let cd = worktree
                .map(|wt| format!("cd '{}' && ", sq_escape(wt)))
                .unwrap_or_default();
            format!("{}exec {}", cd, claude_cmd)
        }
    };

    if program == "ghostty" {
        vec![
            "open".to_string(),
            "-na".to_string(),
            "Ghostty".to_string(),
            "--args".to_string(),
            "-e".to_string(),
            "/bin/sh".to_string(),
            "-lc".to_string(),
            script,
        ]
    } else {
        vec![
            program.to_string(),
            "-e".to_string(),
            "/bin/sh".to_string(),
            "-lc".to_string(),
            script,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- tmux ----

    #[test]
    fn tmux_attach_or_create_with_session_id() {
        let argv = attach_argv("ghostty", Some("tmux"), "spec-feat", Some("/wt/path"), Some("abc123"));
        assert_eq!(argv[..4], ["open", "-na", "Ghostty", "--args"]);
        assert_eq!(argv[4..7], ["-e", "/bin/sh", "-lc"]);
        assert_eq!(argv[7], "exec tmux new-session -A -s 'spec-feat' -c '/wt/path' 'claude --resume '\\''abc123'\\'''");
    }

    #[test]
    fn tmux_attach_or_create_no_session_id() {
        let argv = attach_argv("ghostty", Some("tmux"), "spec-feat", Some("/wt/path"), None);
        assert_eq!(argv[7], "exec tmux new-session -A -s 'spec-feat' -c '/wt/path' 'claude --continue'");
    }

    #[test]
    fn tmux_no_worktree() {
        let argv = attach_argv("ghostty", Some("tmux"), "spec-feat", None, None);
        assert_eq!(argv[7], "exec tmux new-session -A -s 'spec-feat' 'claude --continue'");
    }

    // ---- zellij ----

    #[test]
    fn zellij_attach_or_create_with_session_id() {
        let argv = attach_argv("ghostty", Some("zellij"), "spec-feat", Some("/wt/path"), Some("abc123"));
        let script = &argv[7];
        // attach branch: no second claude on existing session
        assert!(script.starts_with("zellij attach 'spec-feat' 2>/dev/null || "),
            "script should start with attach branch: {script}");
        // create branch: (1) create background session
        assert!(script.contains("zellij attach -b -c 'spec-feat'"),
            "script should create background session: {script}");
        // create branch: (2) run claude in it
        assert!(script.contains("zellij --session 'spec-feat' run"),
            "script should run claude in created session: {script}");
        assert!(script.contains("claude --resume 'abc123'"),
            "script should resume with session id: {script}");
        // create branch: (3) attach so user sees the session
        assert!(script.contains("exec zellij attach 'spec-feat'"),
            "script should attach after create: {script}");
    }

    #[test]
    fn zellij_no_session_id_uses_continue() {
        let argv = attach_argv("ghostty", Some("zellij"), "spec-feat", Some("/wt/path"), None);
        let script = &argv[7];
        assert!(script.contains("claude --continue"), "script should use --continue: {script}");
        assert!(!script.contains("--resume"), "script should not contain --resume: {script}");
    }

    #[test]
    fn zellij_with_worktree_uses_cwd_flag() {
        let argv = attach_argv("ghostty", Some("zellij"), "spec-feat", Some("/wt/path"), Some("id1"));
        let script = &argv[7];
        assert!(script.contains("--cwd '/wt/path'"), "script should set --cwd: {script}");
    }

    #[test]
    fn zellij_no_worktree() {
        let argv = attach_argv("ghostty", Some("zellij"), "spec-feat", None, Some("id1"));
        let script = &argv[7];
        assert!(!script.contains("--cwd"), "no --cwd when worktree is None: {script}");
    }

    // ---- no mux ----

    #[test]
    fn no_mux_with_session_id_execs_claude_resume() {
        let argv = attach_argv("ghostty", None, "spec-feat", Some("/wt/path"), Some("id1"));
        assert_eq!(argv[7], "cd '/wt/path' && exec claude --resume 'id1'");
    }

    #[test]
    fn no_mux_no_session_id_uses_continue() {
        let argv = attach_argv("ghostty", None, "spec-feat", Some("/wt/path"), None);
        assert_eq!(argv[7], "cd '/wt/path' && exec claude --continue");
    }

    #[test]
    fn no_mux_no_worktree_no_session_id() {
        let argv = attach_argv("ghostty", None, "spec-feat", None, None);
        assert_eq!(argv[7], "exec claude --continue");
    }

    // ---- other programs ----

    #[test]
    fn other_program_zellij() {
        let argv = attach_argv("alacritty", Some("zellij"), "spec-feat", Some("/wt"), Some("id1"));
        assert_eq!(argv[0], "alacritty");
        assert_eq!(argv[1..3], ["-e", "/bin/sh"]);
        assert_eq!(argv[3], "-lc");
        assert!(argv[4].contains("zellij attach 'spec-feat'"));
    }

    #[test]
    fn other_program_tmux() {
        let argv = attach_argv("wezterm", Some("tmux"), "spec-feat", None, None);
        assert_eq!(argv[0], "wezterm");
        assert_eq!(argv[4], "exec tmux new-session -A -s 'spec-feat' 'claude --continue'");
    }

    // ---- escaping ----

    #[test]
    fn single_quote_in_worktree_is_escaped() {
        let argv = attach_argv(
            "ghostty",
            Some("zellij"),
            "spec-feat",
            Some("/path/it's here"),
            None,
        );
        assert!(argv[7].contains("--cwd '/path/it'\\''s here'"),
            "worktree single quote should be escaped: {}", argv[7]);
    }

    #[test]
    fn single_quote_in_session_id_is_escaped() {
        let argv = attach_argv("ghostty", None, "spec-feat", None, Some("it's"));
        assert_eq!(argv[7], "exec claude --resume 'it'\\''s'");
    }
}
