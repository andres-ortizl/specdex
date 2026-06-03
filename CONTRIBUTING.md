# Contributing

A Cargo workspace:

```
crates/core   event schema · ~/.spec scanner · state derivation · config/vaults
crates/cli    the `dex` binary
apps/desktop  the Tauri fleet-viz app
```

## Develop

```bash
cargo test                       # all crates
cargo clippy                     # lint
cargo install --path crates/cli  # install the `dex` binary
cargo run -p specdex-desktop     # launch the desktop app
```

The desktop frontend is vanilla HTML/CSS/JS embedded at build time (`apps/desktop/ui/`); `design/` is the same UI as a standalone, browser-openable prototype with sample data.

## Install into your environment

`dex install` copies the `/spec` skill + `dex-*` agents into `~/.claude` and scaffolds `~/.config/dex`. Re-run with `--update` to overwrite the skill after changes.

## App icon

Drop a square PNG at `docs/logo.png`, then:

```bash
cargo tauri icon docs/logo.png   # regenerates the platform icon set
```
