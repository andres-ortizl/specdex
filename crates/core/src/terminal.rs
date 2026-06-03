fn sq_escape(s: &str) -> String {
    s.replace('\'', "'\\''")
}

pub fn attach_argv(
    program: &str,
    mux: Option<&str>,
    session: &str,
    worktree: Option<&str>,
) -> Vec<String> {
    let cd_prefix = worktree
        .map(|wt| format!("cd '{}' && ", sq_escape(wt)))
        .unwrap_or_default();

    let exec_cmd = match mux {
        Some("zellij") => format!("exec zellij attach '{}'", sq_escape(session)),
        Some("tmux") => format!("exec tmux attach -t '{}'", sq_escape(session)),
        _ => "exec \"$SHELL\"".to_string(),
    };

    let script = format!("{cd_prefix}{exec_cmd}");

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

    #[test]
    fn ghostty_zellij_with_worktree() {
        let argv = attach_argv("ghostty", Some("zellij"), "spec-feat", Some("/wt/path"));
        assert_eq!(argv[..4], ["open", "-na", "Ghostty", "--args"]);
        assert_eq!(argv[4..7], ["-e", "/bin/sh", "-lc"]);
        assert_eq!(argv[7], "cd '/wt/path' && exec zellij attach 'spec-feat'");
    }

    #[test]
    fn ghostty_tmux_with_worktree() {
        let argv = attach_argv("ghostty", Some("tmux"), "spec-feat", Some("/wt/path"));
        assert_eq!(argv[7], "cd '/wt/path' && exec tmux attach -t 'spec-feat'");
    }

    #[test]
    fn ghostty_no_mux_with_worktree() {
        let argv = attach_argv("ghostty", None, "spec-feat", Some("/wt/path"));
        assert_eq!(argv[7], "cd '/wt/path' && exec \"$SHELL\"");
    }

    #[test]
    fn ghostty_zellij_no_worktree() {
        let argv = attach_argv("ghostty", Some("zellij"), "spec-feat", None);
        assert_eq!(argv[7], "exec zellij attach 'spec-feat'");
    }

    #[test]
    fn other_program_zellij() {
        let argv = attach_argv("alacritty", Some("zellij"), "spec-feat", Some("/wt"));
        assert_eq!(argv[0], "alacritty");
        assert_eq!(argv[1..3], ["-e", "/bin/sh"]);
        assert_eq!(argv[3], "-lc");
        assert_eq!(argv[4], "cd '/wt' && exec zellij attach 'spec-feat'");
    }

    #[test]
    fn other_program_tmux() {
        let argv = attach_argv("wezterm", Some("tmux"), "spec-feat", None);
        assert_eq!(argv[0], "wezterm");
        assert_eq!(argv[4], "exec tmux attach -t 'spec-feat'");
    }

    #[test]
    fn single_quote_in_worktree_is_escaped() {
        let argv = attach_argv(
            "ghostty",
            Some("zellij"),
            "spec-feat",
            Some("/path/it's here"),
        );
        assert!(argv[7].starts_with("cd '/path/it'\\''s here'"));
    }
}
