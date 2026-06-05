// specdex — fleet + spec-detail. Vanilla JS, no framework, no build step.
// Mirrors crates/core view models. Live data comes from Tauri (`fleet`,
// `spec_detail`); opened directly in a browser it falls back to hardcoded
// samples so this file doubles as a standalone prototype.

const PHASES = [
  "setup", "plan", "build", "review", "ship", "verify", "complete", "accepted",
];
const PHASE_INDEX = Object.fromEntries(PHASES.map((p, i) => [p, i]));

// Motion = real recency, not the health label. A spec is "live" if it changed
// within this window; only then does its life-dot breathe.
const LIVE_WINDOW_MS = 45_000;
const TICK_MS = 5_000;

const ISO = (offsetMs) => new Date(Date.now() - offsetMs).toISOString();

// ~6 sample minions covering every health state + several phases. updated_at
// drives the recency breathing: the two alive specs changed seconds ago (they
// breathe); everything else is calm.
const FLEET = [
  {
    project: "anyformat-backend", name: "parse-cache", phase: "build",
    health: "alive",
    agents: [{ role: "coder", active: true }, { role: "reviewer", active: false }],
    pr: null, blocked_reason: null, review_round: 0, review_score: null, offset: 4,
    updated_at: ISO(6_000),
  },
  {
    project: "anyformat-backend", name: "timeseries-perf", phase: "review",
    health: "alive",
    agents: [{ role: "coder", active: false }, { role: "reviewer", active: true }],
    pr: 3998, blocked_reason: null, review_round: 1, review_score: null, offset: 8,
    updated_at: ISO(22_000),
  },
  {
    project: "specdex", name: "fleet-watch", phase: "plan", mode: "collaborative",
    health: "idle",
    agents: [{ role: "coder", active: false }],
    pr: null, blocked_reason: null, review_round: 0, review_score: null, offset: 0,
    updated_at: ISO(8 * 60_000),
  },
  {
    project: "anyformat-frontend", name: "results-virtualize", phase: "build",
    health: "stale",
    agents: [{ role: "coder", active: false }],
    pr: null, blocked_reason: null, review_round: 0, review_score: null, offset: 12,
    updated_at: ISO(41 * 60_000),
  },
  {
    project: "anyformat-backend", name: "verify-flake", phase: "verify",
    health: "needs-you",
    agents: [{ role: "coder", active: true }, { role: "reviewer", active: false }],
    pr: 4012, blocked_reason: "infra flake on CI — needs a human re-run",
    review_round: 2, review_score: 4, offset: 20,
    updated_at: ISO(12 * 60_000),
  },
  {
    project: "anyformat-sdk", name: "typed-create-proxy", phase: "accepted",
    health: "done",
    agents: [],
    pr: 3990, pr_state: "merged", blocked_reason: null, review_round: 1, review_score: 5, offset: 0,
    updated_at: ISO(2 * 3600_000),
  },
];

// Sample signals for the standalone prototype.
const SAMPLE_SIGNALS = [
  { project: "anyformat-backend", spec: "verify-flake", actor: "reviewer",
    level: "warn", topic: "test-flake", scope: "project",
    text: "CI N+1 query flake in results-serializer — symptom: intermittent test failure; detected: CI; root-cause: unordered join; fix: add ORDER BY",
    time: ISO(44 * 60_000) },
  { project: "anyformat-backend", spec: "parse-cache", actor: "coder",
    level: "error", topic: "env/git", scope: "skill",
    text: "git worktree add fails with 'fatal: branch already checked out' — symptom: worktree creation error; root-cause: stale ref; fix: git worktree prune first",
    time: ISO(2 * 3600_000) },
  { project: "anyformat-frontend", spec: "results-virtualize", actor: "coder",
    level: "info", topic: "orchestration", scope: "project",
    text: "Parallelized three independent chunks (data-layer, component, tests) via sub-agents — 40% faster wall-clock",
    time: ISO(30 * 60_000) },
  { project: "specdex", spec: "fleet-watch", actor: "lead",
    level: "warn", topic: "review-finding", scope: "skill",
    text: "Reviewer flagged missing serde(default) on new field — symptom: deserialize panic on old events; fix: always add default+skip on Option fields",
    time: ISO(90 * 60_000) },
  { project: "anyformat-backend", spec: "timeseries-perf", actor: "coder",
    level: "info", topic: "skill/rust", scope: "skill",
    text: "cargo test with --test-threads=1 needed for integration tests sharing a DB — document in test setup",
    time: ISO(15 * 60_000) },
];

// Sample spec_detail payloads, keyed "project/name", for the standalone prototype.
function sampleDetail(project, name) {
  const t = (ms) => ISO(ms);
  if (project === "anyformat-backend" && name === "verify-flake") {
    return {
      health: "needs-you",
      state: {
        project, name, phase: "verify", mode: "autonomous", branch: "verify-flake",
        worktree: "~/code/anyformat-backend.worktrees/verify-flake",
        session_id: "a1b2c3d4e5f6g7h8",
        offset: 20, ports: { backend: 8020, frontend: 5193, db: 5452 },
        pr: { number: 4012, url: "https://github.com/anyformat-ai/anyformat-backend/pull/4012", state: "open" },
        review_round: 2, review_score: 4,
        blocked_reason: "infra flake on CI — needs a human re-run",
        last_test: { passed: 318, failed: 2 },
        last_gate: { provider: "github-actions", result: "failure" },
        agents: [
          { role: "coder", active: true, since: t(3 * 60_000) },
          { role: "reviewer", active: false, since: t(20 * 60_000) },
        ],
        created_at: t(95 * 60_000), updated_at: t(12 * 60_000),
        last_heartbeat: t(12 * 60_000),
      },
      events: [
        { type: "spec.created", time: t(95 * 60_000), source: "anyformat-backend/verify-flake", actor: "lead",
          data: { branch: "verify-flake", worktree: "~/code/anyformat-backend.worktrees/verify-flake" } },
        { type: "ports.assigned", time: t(95 * 60_000), source: "anyformat-backend/verify-flake", actor: "lead",
          data: { offset: 20, ports: { backend: 8020, frontend: 5193, db: 5452 } } },
        { type: "phase.enter", time: t(94 * 60_000), source: "anyformat-backend/verify-flake", actor: "lead", data: { phase: "plan" } },
        { type: "agent.spawn", time: t(93 * 60_000), source: "anyformat-backend/verify-flake", actor: "lead", data: { role: "coder", agent_id: "c-7a1" } },
        { type: "phase.enter", time: t(80 * 60_000), source: "anyformat-backend/verify-flake", actor: "coder", data: { phase: "build" } },
        { type: "heartbeat", time: t(78 * 60_000), source: "anyformat-backend/verify-flake", actor: "coder", data: {} },
        { type: "heartbeat", time: t(76 * 60_000), source: "anyformat-backend/verify-flake", actor: "coder", data: {} },
        { type: "heartbeat", time: t(74 * 60_000), source: "anyformat-backend/verify-flake", actor: "coder", data: {} },
        { type: "test.result", time: t(60 * 60_000), source: "anyformat-backend/verify-flake", actor: "coder",
          data: { passed: 320, failed: 0, cmd: "pytest -q" } },
        { type: "phase.enter", time: t(58 * 60_000), source: "anyformat-backend/verify-flake", actor: "coder", data: { phase: "review" } },
        { type: "agent.spawn", time: t(57 * 60_000), source: "anyformat-backend/verify-flake", actor: "lead", data: { role: "reviewer", agent_id: "r-3c9" } },
        { type: "review.verdict", time: t(45 * 60_000), source: "anyformat-backend/verify-flake", actor: "reviewer",
          data: { round: 1, verdict: "changes_requested", blockers: 1, issues: 3 } },
        { type: "note", time: t(44 * 60_000), source: "anyformat-backend/verify-flake", actor: "reviewer",
          data: { level: "warn", topic: "perf", text: "N+1 query in the results serializer" } },
        { type: "phase.enter", time: t(30 * 60_000), source: "anyformat-backend/verify-flake", actor: "coder", data: { phase: "build", reason: "addressing review" } },
        { type: "review.verdict", time: t(20 * 60_000), source: "anyformat-backend/verify-flake", actor: "reviewer",
          data: { round: 2, verdict: "approved", blockers: 0, issues: 0 } },
        { type: "agent.idle", time: t(20 * 60_000), source: "anyformat-backend/verify-flake", actor: "reviewer", data: { role: "reviewer" } },
        { type: "pr.created", time: t(18 * 60_000), source: "anyformat-backend/verify-flake", actor: "lead",
          data: { number: 4012, url: "https://github.com/anyformat-ai/anyformat-backend/pull/4012" } },
        { type: "phase.enter", time: t(16 * 60_000), source: "anyformat-backend/verify-flake", actor: "coder", data: { phase: "verify" } },
        { type: "gate.status", time: t(14 * 60_000), source: "github-actions",
          data: { provider: "github-actions", name: "ci", result: "failure" } },
        { type: "test.result", time: t(13 * 60_000), source: "anyformat-backend/verify-flake", actor: "coder",
          data: { passed: 318, failed: 2, cmd: "pytest -q" } },
        { type: "spec.blocked", time: t(12 * 60_000), source: "anyformat-backend/verify-flake", actor: "lead",
          data: { reason: "infra flake on CI — needs a human re-run" } },
      ],
      doc: "# verify-flake\n\nStabilize the flaky results-serializer test under CI load.\n\n## Acceptance Criteria\n- [ ] test passes 50× in a row locally\n- [ ] no N+1 query in the results serializer\n",
      logbook: "# verify-flake — logbook\n\nStatus: BLOCKED\n\n- 95m ago — spec created, worktree + ports assigned\n- 80m ago — build started (coder c-7a1)\n- 60m ago — tests green (320 passed)\n- 45m ago — review round 1: changes requested (1 blocker, 3 issues)\n- 30m ago — addressing review feedback\n- 20m ago — review round 2: approved\n- 18m ago — PR #4012 created\n- 14m ago — CI gate failed (infra flake)\n- 12m ago — BLOCKED: needs a human CI re-run\n",
      config_raw: sampleConfigRaw(project),
    };
  }
  // Generic calm sample for any other card.
  const row = FLEET.find((r) => r.project === project && r.name === name) || FLEET[0];
  return {
    health: row.health,
    state: {
      project, name, phase: row.phase, mode: row.mode || "autonomous", branch: name,
      worktree: "~/code/" + project + ".worktrees/" + name,
      offset: row.offset, ports: { backend: 8000 + (row.offset || 0), frontend: 5173 + (row.offset || 0) },
      pr: row.pr ? { number: row.pr, url: "#", state: row.pr_state || "open" } : undefined,
      review_round: row.review_round, review_score: row.review_score,
      blocked_reason: row.blocked_reason,
      last_test: { passed: 142, failed: 0 },
      last_gate: undefined,
      agents: row.agents.map((a) => ({ ...a, since: ISO(5 * 60_000) })),
      created_at: ISO(60 * 60_000), updated_at: row.updated_at,
      last_heartbeat: row.updated_at,
    },
    events: [
      { type: "spec.created", time: ISO(60 * 60_000), source: project + "/" + name, actor: "lead",
        data: { branch: name, worktree: "~/code/" + project + ".worktrees/" + name } },
      { type: "phase.enter", time: ISO(58 * 60_000), source: project + "/" + name, actor: "lead", data: { phase: "plan" } },
      { type: "agent.spawn", time: ISO(57 * 60_000), source: project + "/" + name, actor: "lead", data: { role: "coder" } },
      { type: "phase.enter", time: ISO(40 * 60_000), source: project + "/" + name, actor: "coder", data: { phase: row.phase } },
      { type: "heartbeat", time: ISO(20 * 60_000), source: project + "/" + name, actor: "coder", data: {} },
      { type: "heartbeat", time: ISO(15 * 60_000), source: project + "/" + name, actor: "coder", data: {} },
      { type: "note", time: ISO(10 * 60_000), source: project + "/" + name, actor: "coder",
        data: { level: "info", topic: "status", text: "working through the " + row.phase + " step" } },
    ],
    doc: row.mode === "collaborative"
      ? "# " + name + "\n\nHuman-driven session — planning live with the lead.\n"
      : null,
    logbook: "# " + name + " — logbook\n\nStatus: " + row.phase.toUpperCase() + "\n\n- 60m ago — spec created\n- 40m ago — entered " + row.phase + "\n- 10m ago — working through the " + row.phase + " step\n",
    config_raw: sampleConfigRaw(project),
  };
}

function sampleConfigRaw(project) {
  if (project === "specdex") {
    return `[providers]
notifier = "none"
ci = "none"
pr_review = "none"

[terminal]
program = "ghostty"

[identity]
github_org = "andres-ortizl"
`;
  }
  return `[providers]
notifier = "slack"
ci = "github-actions"
pr_review = "greptile"

[models]
coder = "sonnet"
reviewer = "opus"

[[ports]]
service = "backend"
base = 8000
env = "BACKEND_PORT"

[[ports]]
service = "frontend"
base = 5173
env = "VITE_PORT"
`;
}

// Curated config summary for the standalone prototype sidebar (no Tauri backend).
function sampleConfig(project) {
  if (project === "specdex") {
    return {
      providers: { notifier: "none", ci: "none", pr_review: "none" },
      terminal: { program: "ghostty" },
      identity: { github_org: "andres-ortizl" },
      ports: [], models: {}, phases_skip: [],
      reactors: {},
    };
  }
  return {
    providers: { notifier: "slack", ci: "github-actions", pr_review: "greptile" },
    ports: [
      { service: "backend", base: 8000, env: "BACKEND_PORT" },
      { service: "frontend", base: 5173, env: "VITE_PORT" },
    ],
    models: { coder: "sonnet", reviewer: "opus" },
    phases_skip: [],
    reactors: { ci: "/react-to-pipelines", pr_review: "/react-to-greptile" },
  };
}

const ICONS = {
  flag:
    '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 21V4M4 4h12l-2 4 2 4H4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sun:
    '<svg viewBox="0 0 24 24" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" stroke-linecap="round"/></svg>',
  moon:
    '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M21 12.5A8.5 8.5 0 1 1 11.5 3a6.5 6.5 0 0 0 9.5 9.5z" stroke-linejoin="round"/></svg>',
  system:
    '<svg viewBox="0 0 24 24" stroke-width="1.8"><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4" stroke-linecap="round"/></svg>',
  back:
    '<svg viewBox="0 0 24 24" stroke-width="1.9"><path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  terminal:
    '<svg viewBox="0 0 24 24" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  caret:
    '<svg viewBox="0 0 24 24" stroke-width="2"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// timeline glyphs per event family
const EV_ICON = {
  created:   '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>',
  ports:     '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 12h16M4 7h16M4 17h16" stroke-linecap="round"/></svg>',
  phase:     '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  blocked:   '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 21V4M4 4h12l-2 4 2 4H4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  unblocked: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M5 12l5 5 9-11" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  heartbeat: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M3 12h4l2-5 4 10 2-5h6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  agent:     '<svg viewBox="0 0 24 24" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0" stroke-linecap="round"/></svg>',
  test:      '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  review:    '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M12 5C6 5 2.7 9.5 2 12c.7 2.5 4 7 10 7s9.3-4.5 10-7c-.7-2.5-4-7-10-7z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  gate:      '<svg viewBox="0 0 24 24" stroke-width="1.8"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke-linecap="round"/></svg>',
  pr:        '<svg viewBox="0 0 24 24" stroke-width="1.8"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M6 8.4v7.2M18 15.6V12a3 3 0 0 0-3-3h-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  note:      '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M5 4h14v12l-4 4H5z" stroke-linejoin="round"/><path d="M9 9h6M9 13h4" stroke-linecap="round"/></svg>',
  dot:       '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>',
};

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

// The one chip that tells a human-driven spec apart from an autonomous minion.
function modeBadge(mode, opts) {
  if (mode !== "collaborative") return null;
  const b = el("span", "mode-badge" + (opts && opts.sb ? " sb" : ""));
  b.textContent = "collab";
  b.title = "Collaborative — human-driven session";
  return b;
}

// Status chip next to a PR link — only shown once it leaves "open".
function prStateChip(state) {
  const c = el("span", "pr-state pr-" + state);
  c.textContent = state;
  c.title = "PR " + state;
  return c;
}

const isLive = (updatedAt) =>
  updatedAt != null && Date.now() - Date.parse(updatedAt) < LIVE_WINDOW_MS;

function relTime(iso) {
  const diff = Date.now() - Date.parse(iso);
  if (!isFinite(diff)) return "";
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 45) return s <= 5 ? "just now" : s + "s ago";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.round(h / 24);
  return d + "d ago";
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Exact UTC stamp for timeline rows — relative "ago" lives once in the header.
function fmtUTC(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function renderRail(currentPhase, opts) {
  const complete = opts && opts.complete;
  const rail = el("div", "rail" + (complete ? " complete" : ""));
  const cur = PHASE_INDEX[currentPhase] ?? 0;
  PHASES.forEach((phase, i) => {
    if (i > 0) rail.appendChild(el("span", "rail-link" + (i <= cur ? " done" : "")));
    let cls = "rail-node";
    if (i < cur) cls += " done";
    else if (i === cur) cls += " current";
    const node = el("span", cls);
    node.title = phase;
    rail.appendChild(node);
  });
  return rail;
}

function healthDot(health) {
  const d = el("span", "dot");
  d.dataset.health = health;
  d.title = health;
  return d;
}

// ============================ fleet ============================

function renderMinion(row) {
  const card = el("article", "minion");
  card.dataset.health = row.health;
  card.dataset.phase = row.phase;
  card.dataset.project = row.project;
  card.dataset.name = row.name;
  if (isLive(row.updated_at)) card.classList.add("live");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", row.name + " — " + row.phase + ", " + row.health);

  const open = () => navigate({ view: "detail", project: row.project, name: row.name });
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });

  const head = el("div", "m-head");
  head.appendChild(healthDot(row.health));

  const name = el("span", "m-name");
  name.textContent = row.name;
  name.title = row.name;
  head.appendChild(name);

  if (row.pr != null) {
    const wrap = el("div", "m-pr-wrap");
    const pr = el("a", "m-pr");
    pr.textContent = "PR " + row.pr;
    pr.href = "#";
    pr.title = "Pull request #" + row.pr;
    pr.addEventListener("click", (e) => e.stopPropagation());
    wrap.appendChild(pr);
    if (row.pr_state && row.pr_state !== "open") wrap.appendChild(prStateChip(row.pr_state));
    head.appendChild(wrap);
  } else {
    head.appendChild(el("span"));
  }

  const projectRow = el("div", "m-project-row");
  const project = el("span", "m-project");
  project.textContent = row.project;
  project.title = row.project;
  projectRow.appendChild(project);
  const badge = modeBadge(row.mode);
  if (badge) projectRow.appendChild(badge);
  head.appendChild(projectRow);
  card.appendChild(head);

  const phaseWrap = el("div", "m-phase");
  phaseWrap.appendChild(renderRail(row.phase, { complete: row.health === "done" }));
  const label = el("span", "phase-label");
  label.textContent = row.phase;
  phaseWrap.appendChild(label);
  card.appendChild(phaseWrap);

  const foot = el("div", "m-foot");
  const agents = el("div", "agents");
  if (row.agents.length === 0) {
    const none = el("span", "agent");
    none.style.color = "var(--ink-faint)";
    none.textContent = "no agents";
    agents.appendChild(none);
  } else {
    row.agents.forEach((a) => {
      const ag = el("div", "agent" + (a.active ? " active" : ""));
      ag.appendChild(el("span", "agent-pip"));
      ag.appendChild(document.createTextNode(a.role));
      agents.appendChild(ag);
    });
  }
  foot.appendChild(agents);

  const meta = el("div", "review-meta");
  if (row.review_round > 0) {
    const r = el("span");
    r.textContent = "round " + row.review_round;
    meta.appendChild(r);
  }
  if (row.review_score != null) {
    const s = el("span", "score");
    s.innerHTML = '<span class="star">★</span>' + row.review_score;
    meta.appendChild(s);
  }
  if (meta.childNodes.length) foot.appendChild(meta);
  card.appendChild(foot);

  if (row.health === "needs-you" && row.blocked_reason) {
    const blocked = el("div", "m-blocked");
    blocked.innerHTML = ICONS.flag;
    blocked.appendChild(document.createTextNode(row.blocked_reason));
    card.appendChild(blocked);
  }

  return card;
}

function renderListHeader() {
  const h = el("div", "list-cols");
  h.setAttribute("role", "row");
  [
    ["", "c-dot"], ["spec", "c-name"], ["phase", "c-rail"], ["", "c-phaselbl"],
    ["agents", "c-agents"], ["pr", "c-pr"], ["review", "c-round num"], ["updated", "c-updated num"],
  ].forEach(([label, cls]) => {
    const c = el("div", "col-h " + cls);
    c.setAttribute("role", "columnheader");
    c.textContent = label;
    h.appendChild(c);
  });
  return h;
}

function renderListRow(row) {
  const r = el("a", "list-row");
  r.href = "#";
  r.setAttribute("role", "row");
  r.setAttribute("aria-label", row.name + " — " + row.phase + ", " + row.health);
  r.addEventListener("click", (e) => {
    e.preventDefault();
    navigate({ view: "detail", project: row.project, name: row.name });
  });

  const dotCell = el("div", "lc-dot");
  dotCell.appendChild(healthDot(row.health));
  r.appendChild(dotCell);

  const nameCell = el("div", "lc-name");
  const nm = el("span", "nm"); nm.textContent = row.name; nm.title = row.name;
  nameCell.appendChild(nm);
  const pj = el("span", "pj"); pj.textContent = row.project; pj.title = row.project;
  const badge = modeBadge(row.mode);
  if (badge) pj.appendChild(badge);
  nameCell.appendChild(pj);
  if (row.health === "needs-you" && row.blocked_reason) {
    const bl = el("span", "blocked", ICONS.flag);
    bl.appendChild(document.createTextNode(row.blocked_reason));
    bl.title = row.blocked_reason;
    nameCell.appendChild(bl);
  }
  r.appendChild(nameCell);

  const railCell = el("div", "lc-rail");
  railCell.appendChild(renderRail(row.phase, { complete: row.health === "done" }));
  r.appendChild(railCell);

  const phaseCell = el("div", "lc-phase");
  phaseCell.textContent = row.phase;
  r.appendChild(phaseCell);

  const agentsCell = el("div", "lc-agents");
  if (row.agents.length === 0) {
    const none = el("span", "agent none lc-empty"); none.textContent = "—"; agentsCell.appendChild(none);
  } else {
    row.agents.forEach((a) => {
      const ag = el("div", "agent" + (a.active ? " active" : ""));
      ag.appendChild(el("span", "agent-pip"));
      ag.appendChild(document.createTextNode(a.role));
      agentsCell.appendChild(ag);
    });
  }
  r.appendChild(agentsCell);

  const prCell = el("div", "lc-pr");
  if (row.pr != null) {
    const a = el("a"); a.href = "#"; a.textContent = "PR " + row.pr;
    a.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    prCell.appendChild(a);
    if (row.pr_state && row.pr_state !== "open") prCell.appendChild(prStateChip(row.pr_state));
  } else {
    prCell.innerHTML = '<span class="lc-empty">—</span>';
  }
  r.appendChild(prCell);

  const roundCell = el("div", "lc-round");
  if (row.review_round > 0 || row.review_score != null) {
    let html = "";
    if (row.review_round > 0) html += "r" + row.review_round;
    if (row.review_score != null) html += (html ? " " : "") + '<span class="star">★</span>' + row.review_score;
    roundCell.innerHTML = html;
  } else {
    roundCell.innerHTML = '<span class="lc-empty">—</span>';
  }
  r.appendChild(roundCell);

  const upCell = el("div", "lc-updated");
  upCell.textContent = relTime(row.updated_at);
  upCell.title = row.updated_at || "";
  r.appendChild(upCell);

  return r;
}

let LAST_FLEET = [];
let LAST_SIGNALS = [];
let SIGNALS_SCOPE_FILTER = "all";

// Fleet sort: "recent" (last activity), "state" (health), or "name". Persisted.
const FLEET_SORTS = ["recent", "state", "name"];
let FLEET_SORT = FLEET_SORTS.includes(localStorage.dexFleetSort) ? localStorage.dexFleetSort : "recent";

// Fleet layout: "list" (default) or "cards". Persisted.
let LAYOUT = ["list", "cards"].includes(localStorage.dexFleetLayout) ? localStorage.dexFleetLayout : "list";
// State order = activity gradient: working first, done last.
const HEALTH_RANK = { alive: 0, "needs-you": 1, idle: 2, stale: 3, done: 4 };

function sortRows(rows) {
  const r = [...rows];
  const recency = (a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0);
  const byName = (a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name);
  if (FLEET_SORT === "name") return r.sort(byName);
  if (FLEET_SORT === "state") {
    return r.sort(
      (a, b) => (HEALTH_RANK[a.health] ?? 9) - (HEALTH_RANK[b.health] ?? 9) || recency(a, b) || byName(a, b)
    );
  }
  return r.sort((a, b) => recency(a, b) || byName(a, b));
}

// Team panes polling (C3 / D2): runs only while the detail is open.
let TEAM_POLL_TIMER = null;
let TEAM_PANES_WRAP = null;

function stopTeamPoll() {
  if (TEAM_POLL_TIMER !== null) {
    clearInterval(TEAM_POLL_TIMER);
    TEAM_POLL_TIMER = null;
  }
}

async function loadTeamPanes(project, name) {
  const t = window.__TAURI__;
  if (t && t.core) {
    return await t.core.invoke("team_panes", { project, name })
      .catch(() => ({ socket_name: null, panes: [] }));
  }
  return sampleTeamPanes(project, name);
}

// Sample fallback for the standalone browser prototype.
function sampleTeamPanes(project, name) {
  const row = LAST_FLEET.find((r) => r.project === project && r.name === name);
  if (!row || row.health !== "alive") return { socket_name: null, panes: [] };
  return {
    socket_name: "claude-swarm-12345",
    panes: [
      { title: "dex-coder", text: "→ Implementing attach_argv...\n  RED: terminal tests\n  Writing tmux new-session -A ...\n  cargo test\n" },
      { title: "dex-reviewer", text: "Waiting for coder report...\n" },
    ],
  };
}

function renderTeamPanes(result) {
  const panes = result && result.panes ? result.panes : [];
  const wrap = el("div", "d-team-panes");
  if (panes.length === 0) return wrap; // empty; CSS hides via :empty
  const headRow = el("div", "team-panes-head-row");
  headRow.appendChild(el("span", "team-panes-head", "live team"));
  // Watch team button: opens a read-only terminal view of the live swarm session.
  if (result && result.socket_name) {
    const watchBtn = el("button", "d-attach");
    watchBtn.type = "button";
    watchBtn.innerHTML = ICONS.terminal;
    watchBtn.appendChild(document.createTextNode("watch"));
    watchBtn.addEventListener("click", () => {
      const t = window.__TAURI__;
      if (t && t.core && CURRENT_DETAIL) {
        t.core.invoke("watch_team", {
          project: CURRENT_DETAIL.state.project,
          name: CURRENT_DETAIL.state.name,
        }).catch(() => {});
      }
    });
    headRow.appendChild(watchBtn);
  }
  wrap.appendChild(headRow);
  panes.forEach(({ title, text }) => {
    const pane = el("div", "team-pane");
    pane.appendChild(el("span", "team-pane-label", title));
    const pre = el("pre", "team-pane-text");
    pre.textContent = text;
    pane.appendChild(pre);
    wrap.appendChild(pane);
  });
  return wrap;
}

function updateTeamPanesPanel(result, project, name) {
  const hasTeam = result && result.panes && result.panes.length > 0;
  // Drive the "working now" pulse from real pane data rather than the health label.
  const detail = document.getElementById("detail");
  if (detail && !detail.hidden) {
    if (hasTeam) detail.dataset.working = "true";
    else delete detail.dataset.working;
  }
  document.querySelectorAll(".minion").forEach((card) => {
    if (card.dataset.project === project && card.dataset.name === name) {
      if (hasTeam) card.dataset.working = "true";
      else delete card.dataset.working;
    }
  });
  // Update the pane panel content
  if (TEAM_PANES_WRAP) {
    while (TEAM_PANES_WRAP.firstChild) TEAM_PANES_WRAP.removeChild(TEAM_PANES_WRAP.firstChild);
    const fresh = renderTeamPanes(result || { socket_name: null, panes: [] });
    while (fresh.firstChild) TEAM_PANES_WRAP.appendChild(fresh.firstChild);
  }
}

// Sidebar state: which projects are expanded + a per-project config cache
// (undefined = not fetched, "loading", null = none, or the Effective object).
const SB_EXPANDED = new Set();
const SB_CONFIG = {};

function renderFleet(rows) {
  LAST_FLEET = rows || [];
  renderSidebar(LAST_FLEET);
  const fleetEl = document.getElementById("fleet");
  const listwrap = document.getElementById("listwrap");
  const list = document.getElementById("list");
  const count = document.getElementById("fleet-count");

  if (!rows || rows.length === 0) {
    fleetEl.textContent = "";
    const empty = el(
      "div", null,
      'No active specs yet.<br><span style="font-size:13px">Start one with <code>/spec</code> — minions appear here as they run.</span>'
    );
    empty.style.cssText =
      "grid-column:1/-1;color:var(--ink-faint);text-align:center;padding:56px 8px;line-height:1.7";
    fleetEl.appendChild(empty);
    count.textContent = "0 specs";
    fleetEl.hidden = false;
    listwrap.hidden = true;
    return;
  }

  count.textContent = rows.length + (rows.length === 1 ? " spec" : " specs");
  const sorted = sortRows(rows);

  const onFleet = document.getElementById("detail").hidden;
  if (onFleet) {
    fleetEl.hidden = LAYOUT !== "cards";
    listwrap.hidden = LAYOUT !== "list";
  }

  if (LAYOUT === "cards") {
    fleetEl.textContent = "";
    sorted.forEach((row, i) => {
      const card = renderMinion(row);
      card.style.animationDelay = i * 40 + "ms";
      fleetEl.appendChild(card);
    });
  } else {
    list.textContent = "";
    list.appendChild(renderListHeader());
    sorted.forEach((row, i) => {
      const r = renderListRow(row);
      r.style.animationDelay = i * 24 + "ms";
      list.appendChild(r);
    });
  }
}

// Re-evaluate liveness on a slow tick: motion follows real recency, not labels.
function tickLiveness() {
  document.querySelectorAll(".minion").forEach((card) => {
    const row = LAST_FLEET.find(
      (r) => r.project === card.dataset.project && r.name === card.dataset.name
    );
    card.classList.toggle("live", row ? isLive(row.updated_at) : false);
  });
  const d = document.getElementById("detail");
  if (!d.hidden && d.dataset.updatedAt) {
    d.classList.toggle("live", isLive(d.dataset.updatedAt));
  }
}

// ============================ sidebar ============================
// Projects (grouped from the fleet) → expand to read-only config + nested specs.

function renderSidebar(rows) {
  const root = document.getElementById("sidebar");
  if (!root) return;
  root.textContent = "";
  root.appendChild(el("div", "sb-head", "Projects"));

  if (!rows || rows.length === 0) {
    root.appendChild(el("div", "sb-empty", "No projects yet.<br>Start a spec to populate the fleet."));
    return;
  }

  const byProject = new Map();
  [...rows]
    .sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name))
    .forEach((r) => {
      if (!byProject.has(r.project)) byProject.set(r.project, []);
      byProject.get(r.project).push(r);
    });

  byProject.forEach((specs, project) => {
    const open = SB_EXPANDED.has(project);
    const section = el("section", "sb-project" + (open ? " open" : ""));
    section.dataset.project = project;

    const head = el("button", "sb-proj-head");
    head.type = "button";
    head.setAttribute("aria-expanded", open ? "true" : "false");
    head.appendChild(el("span", "sb-btn"));
    const name = el("span", "sb-proj-name");
    name.textContent = project;
    name.title = project;
    head.appendChild(name);
    const count = el("span", "sb-proj-count");
    count.textContent = specs.length;
    head.appendChild(count);
    head.addEventListener("click", () => {
      if (SB_EXPANDED.has(project)) SB_EXPANDED.delete(project);
      else SB_EXPANDED.add(project);
      renderSidebar(LAST_FLEET);
    });
    section.appendChild(head);

    if (open) {
      const body = el("div", "sb-proj-body");
      body.appendChild(renderConfig(project));
      section.appendChild(body);
      loadConfigIfNeeded(project);
    }
    root.appendChild(section);
  });
}

function cfgRow(k, v) {
  const row = el("div", "sb-cfg-row");
  const key = el("span", "sb-cfg-key");
  key.textContent = k;
  const val = el("span", "sb-cfg-val");
  val.textContent = v;
  val.title = v;
  row.append(key, val);
  return row;
}

// Read-only at-a-glance summary — only the fields that are set. The full
// verbatim .dex.toml lives in the spec detail's `.dex.toml` tab.
function renderConfig(project) {
  const wrap = el("div", "sb-config");
  const cfg = SB_CONFIG[project];
  if (cfg === undefined || cfg === "loading") {
    wrap.classList.add("muted");
    wrap.appendChild(cfgRow("config", "loading…"));
    return wrap;
  }
  if (cfg === null) {
    wrap.classList.add("muted");
    wrap.appendChild(cfgRow("config", "none"));
    return wrap;
  }
  const rows = [];
  const p = cfg.providers || {};
  const reactors = cfg.reactors || {};
  ["notifier", "ci", "pr_review", "multiplexer"].forEach((k) => {
    if (p[k]) {
      rows.push([k.replace("_", " "), p[k]]);
      const reactor = reactors[k];
      if (reactor) rows.push(["↳ reactor", reactor]);
    }
  });
  const m = cfg.models || {};
  ["coder", "reviewer", "designer", "curator"].forEach((k) => { if (m[k]) rows.push([k, m[k]]); });
  if (cfg.terminal && cfg.terminal.program) rows.push(["terminal", cfg.terminal.program]);
  if (cfg.ports && cfg.ports.length) rows.push(["ports", cfg.ports.map((x) => x.service).join(", ")]);
  if (cfg.phases_skip && cfg.phases_skip.length) rows.push(["skip", cfg.phases_skip.join(", ")]);
  if (cfg.identity && cfg.identity.github_org) rows.push(["github", cfg.identity.github_org]);
  if (cfg.hooks && Object.keys(cfg.hooks).length) {
    const refs = Object.values(cfg.hooks).map((a) => (a && a.ref) || a).filter(Boolean).join(", ");
    if (refs) rows.push(["hooks", refs]);
  }
  if (rows.length === 0) {
    wrap.classList.add("muted");
    wrap.appendChild(cfgRow("config", "empty"));
    return wrap;
  }
  rows.forEach(([k, v]) => wrap.appendChild(cfgRow(k, v)));
  return wrap;
}

async function loadProjectConfig(project) {
  const t = window.__TAURI__;
  if (t && t.core) {
    try { return await t.core.invoke("project_config", { project }); }
    catch (_) { return null; }
  }
  return sampleConfig(project);
}

function loadConfigIfNeeded(project) {
  if (SB_CONFIG[project] !== undefined) return; // cached, loading, or known-null
  SB_CONFIG[project] = "loading";
  loadProjectConfig(project)
    .then((cfg) => { SB_CONFIG[project] = cfg || null; renderSidebar(LAST_FLEET); })
    .catch(() => { SB_CONFIG[project] = null; renderSidebar(LAST_FLEET); });
}

// ============================ detail ============================

// Copy `text` to the clipboard; briefly swap `node`'s text to "copied ✓".
function copyText(text, node, restore) {
  const flash = () => {
    node.classList.add("copied");
    node.textContent = "copied ✓";
    setTimeout(() => { node.classList.remove("copied"); node.textContent = restore; }, 1100);
  };
  const fallback = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      flash();
    } catch (_) { /* clipboard unavailable */ }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash).catch(fallback);
  } else {
    fallback();
  }
}

function kv(key, valNode, opts) {
  const wrap = el("div", "kv" + (opts && opts.span ? " span-all" : ""));
  const k = el("span", "kv-key");
  k.textContent = key;
  wrap.appendChild(k);
  if (typeof valNode === "string") {
    const v = el("span", "kv-val" + (opts && opts.mono ? " mono" : ""));
    v.textContent = valNode;
    wrap.appendChild(v);
  } else {
    wrap.appendChild(valNode);
  }
  return wrap;
}

function renderState(s) {
  const panel = el("div", "d-state");

  if (s.branch) panel.appendChild(kv("branch", s.branch, { mono: true }));
  if (s.mode === "collaborative") panel.appendChild(kv("mode", "collaborative"));
  if (s.session_id) {
    const short = s.session_id.length > 12 ? s.session_id.slice(0, 12) + "…" : s.session_id;
    const v = el("span", "kv-val mono copyable");
    v.textContent = short;
    v.title = "Click to copy " + s.session_id;
    v.addEventListener("click", () => copyText(s.session_id, v, short));
    panel.appendChild(kv("session id", v));
  }
  if (s.offset != null) panel.appendChild(kv("port offset", "+" + s.offset, { mono: true }));

  if (s.ports && Object.keys(s.ports).length) {
    const v = el("span", "kv-val mono");
    v.textContent = Object.entries(s.ports).map(([k, p]) => k + ":" + p).join("  ");
    panel.appendChild(kv("ports", v));
  }

  if (s.pr) {
    const v = el("span", "kv-val mono");
    const a = el("a");
    a.href = s.pr.url || "#";
    a.textContent = "PR " + s.pr.number;
    if (window.__TAURI__) a.addEventListener("click", (e) => e.preventDefault());
    v.appendChild(a);
    if (s.pr.state && s.pr.state !== "open") {
      v.appendChild(document.createTextNode("  "));
      v.appendChild(prStateChip(s.pr.state));
    }
    panel.appendChild(kv("pull request", v));
  }

  if (s.review_round > 0 || s.review_score != null) {
    const v = el("span", "kv-val");
    let html = "";
    if (s.review_round > 0) html += "round " + s.review_round;
    if (s.review_score != null) html += (html ? "  " : "") + '<span class="star">★</span>' + s.review_score;
    v.innerHTML = html;
    panel.appendChild(kv("review", v));
  }

  if (s.last_test) {
    const v = el("span", "kv-val");
    v.innerHTML =
      '<span class="pass">' + s.last_test.passed + " passed</span>" +
      (s.last_test.failed > 0 ? '  <span class="fail">' + s.last_test.failed + " failed</span>" : "");
    panel.appendChild(kv("last test", v));
  }

  if (s.last_gate) {
    const ok = s.last_gate.result === "success" || s.last_gate.result === "approved";
    const v = el("span", "kv-val");
    v.innerHTML = '<span class="' + (ok ? "pass" : "fail") + '">' +
      s.last_gate.provider + " · " + s.last_gate.result + "</span>";
    panel.appendChild(kv("gate", v));
  }

  if (s.worktree) panel.appendChild(kv("worktree", s.worktree, { mono: true, span: true }));

  if (s.blocked_reason) {
    const v = el("span", "kv-val blocked");
    v.textContent = "⚑ " + s.blocked_reason;
    panel.appendChild(kv("blocked", v, { span: true }));
  }

  return panel;
}

// Per-type one-line human summary + classification.
function describeEvent(ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case "spec.created":
      return { kind: "created", cls: "", html: "Spec created", sub: d.branch ? "branch " + d.branch : "" };
    case "ports.assigned":
      return { kind: "ports", cls: "",
        html: "Ports assigned <span class=\"em\">+" + (d.offset ?? "") + "</span>",
        sub: d.ports ? Object.entries(d.ports).map(([k, p]) => k + ":" + p).join("  ") : "" };
    case "phase.enter":
      return { kind: "phase", cls: "milestone",
        html: "Entered <span class=\"em\">" + d.phase + "</span>",
        sub: d.reason || "" };
    case "spec.blocked":
      return { kind: "blocked", cls: "attn", html: "Blocked — needs you", sub: d.reason || "" };
    case "spec.unblocked":
      return { kind: "unblocked", cls: "", html: "Unblocked", sub: "" };
    case "heartbeat":
      return { kind: "heartbeat", cls: "muted", html: "heartbeat", sub: "", heartbeat: true };
    case "agent.spawn":
      return { kind: "agent", cls: "",
        html: "<span class=\"em\">" + d.role + "</span> spawned",
        sub: d.agent_id || "" };
    case "agent.idle":
      return { kind: "agent", cls: "", html: "<span class=\"em\">" + d.role + "</span> went idle", sub: "" };
    case "test.result": {
      const ok = (d.failed || 0) === 0;
      return { kind: "test", cls: ok ? "" : "attn",
        html: "Tests " + (ok ? "passed" : "<span class=\"em\">failed</span>") +
          " — " + d.passed + " passed" + (d.failed ? ", " + d.failed + " failed" : ""),
        sub: d.cmd || "" };
    }
    case "review.verdict": {
      const ok = d.verdict === "approved";
      return { kind: "review", cls: ok ? "milestone" : "attn",
        html: "Review round " + d.round + " — <span class=\"em\">" + d.verdict.replace(/_/g, " ") + "</span>",
        sub: ok ? "" : (d.blockers || 0) + " blockers · " + (d.issues || 0) + " issues" };
    }
    case "gate.status": {
      const ok = d.result === "success";
      return { kind: "gate", cls: ok ? "" : "attn",
        html: (d.name || d.provider) + " — <span class=\"em\">" + d.result + "</span>" +
          (d.score != null ? " (" + d.score + ")" : ""),
        sub: d.provider || "" };
    }
    case "pr.created":
      return { kind: "pr", cls: "milestone", html: "PR <span class=\"em\">#" + d.number + "</span> opened", sub: d.url || "" };
    case "note":
      return { kind: "note", cls: d.level === "warn" || d.level === "error" ? "attn" : "",
        html: (d.topic ? "<span class=\"em\">" + d.topic + "</span> — " : "") + (d.text || ""),
        sub: "" };
    default:
      return { kind: "dot", cls: "", html: ev.type, sub: "" };
  }
}

let HEARTBEATS_EXPANDED = false;

function renderTimeline(events) {
  const wrap = el("div", "d-timeline");

  const head = el("div", "tl-head");
  const newest = [...events].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
  const hdLeft = el("div", "tl-head-left");
  const updated = el("span", "tl-updated");
  if (newest) {
    updated.textContent = "updated " + relTime(newest.time);
    updated.title = fmtUTC(newest.time) + " UTC";
  }
  hdLeft.appendChild(updated);
  const utcNote = el("span", "tl-utc-note");
  utcNote.textContent = "times in UTC";
  hdLeft.appendChild(utcNote);
  head.appendChild(hdLeft);

  const hbCount = events.filter((e) => e.type === "heartbeat").length;
  const toggle = el("button", "tl-toggle");
  toggle.type = "button";
  toggle.textContent = HEARTBEATS_EXPANDED
    ? "hide heartbeats"
    : "show " + hbCount + " heartbeat" + (hbCount === 1 ? "" : "s");
  toggle.style.visibility = hbCount > 0 ? "visible" : "hidden";
  toggle.addEventListener("click", () => {
    HEARTBEATS_EXPANDED = !HEARTBEATS_EXPANDED;
    renderDetail(CURRENT_DETAIL); // re-render with new collapse state
  });
  head.appendChild(toggle);
  wrap.appendChild(head);

  // newest-first reads like a feed of "what just happened"
  const sorted = [...events].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));

  const tl = el("div", "tl");
  let pendingHb = [];

  const flushHb = () => {
    if (!pendingHb.length) return;
    if (HEARTBEATS_EXPANDED) {
      pendingHb.forEach((ev) => tl.appendChild(eventRow(ev)));
    } else if (pendingHb.length === 1) {
      tl.appendChild(eventRow(pendingHb[0]));
    } else {
      // collapse a run of heartbeats into one quiet line
      const first = pendingHb[0], last = pendingHb[pendingHb.length - 1];
      const row = el("div", "tl-row hb-collapsed");
      row.appendChild(el("span", "tl-glyph", EV_ICON.heartbeat));
      const body = el("div", "tl-body");
      const sum = el("span", "tl-summary");
      sum.textContent = pendingHb.length + " heartbeats";
      sum.title = "Click to expand";
      sum.addEventListener("click", () => {
        HEARTBEATS_EXPANDED = true;
        renderDetail(CURRENT_DETAIL);
      });
      body.appendChild(sum);
      row.appendChild(body);
      const time = el("span", "tl-time");
      time.textContent = fmtUTC(first.time);
      time.title = last.time + " – " + first.time;
      row.appendChild(time);
      tl.appendChild(row);
    }
    pendingHb = [];
  };

  sorted.forEach((ev) => {
    if (ev.type === "heartbeat" && !HEARTBEATS_EXPANDED) { pendingHb.push(ev); return; }
    flushHb();
    tl.appendChild(eventRow(ev));
  });
  flushHb();

  wrap.appendChild(tl);
  return wrap;
}

function eventRow(ev) {
  const info = describeEvent(ev);
  const row = el("div", "tl-row" + (info.cls ? " " + info.cls : ""));

  row.appendChild(el("span", "tl-glyph", EV_ICON[info.kind] || EV_ICON.dot));

  const body = el("div", "tl-body");
  const sum = el("span", "tl-summary", info.html);
  body.appendChild(sum);
  if (info.sub) {
    const sub = el("span", "tl-sub");
    sub.textContent = info.sub;
    sub.title = info.sub;
    body.appendChild(sub);
  }
  row.appendChild(body);

  const timeWrap = el("div", "tl-time-col");
  const time = el("span", "tl-time");
  time.textContent = fmtUTC(ev.time);
  time.title = ev.time + (ev.source ? "  ·  " + ev.source : "");
  timeWrap.appendChild(time);
  const actor = ev.actor || "system";
  const by = el("span", "tl-actor");
  by.textContent = "by " + actor;
  timeWrap.appendChild(by);
  row.appendChild(timeWrap);

  return row;
}

let CURRENT_DETAIL = null;

function renderDetail(detail) {
  CURRENT_DETAIL = detail;
  const s = detail.state;
  const root = document.getElementById("detail");
  root.textContent = "";
  root.dataset.health = detail.health;
  root.dataset.updatedAt = s.updated_at || "";
  root.classList.toggle("live", isLive(s.updated_at));

  const back = el("button", "d-back");
  back.type = "button";
  back.innerHTML = ICONS.back;
  back.appendChild(document.createTextNode("agents"));
  back.addEventListener("click", () => navigate({ view: "fleet" }));
  root.appendChild(back);

  const head = el("div", "d-head");

  const titleRow = el("div", "d-title-row");
  const title = el("div", "d-title");
  const proj = el("span", "d-project"); proj.textContent = s.project;
  const slash = el("span", "d-slash"); slash.textContent = "/";
  const nm = el("span", "d-name"); nm.textContent = s.name;
  title.append(proj, slash, nm);
  titleRow.appendChild(title);

  const health = el("div", "d-health");
  health.appendChild(el("span", "life-dot"));
  health.appendChild(document.createTextNode(detail.health));
  titleRow.appendChild(health);

  const dbadge = modeBadge(s.mode);
  if (dbadge) titleRow.appendChild(dbadge);

  // drams hardware push-button: round glossy orange face + an LED that lights
  // ember while attaching. Icon-only; the label lives in the tooltip.
  const attachCell = el("div", "hw-attach");
  const attachLed = el("span", "hw-led");
  const attach = el("button", "hw-btn");
  attach.type = "button";
  attach.title = "attach in terminal";
  attach.setAttribute("aria-label", "attach in terminal");
  const attachFace = el("span", "hw-face orange");
  attachFace.innerHTML = ICONS.terminal;
  attach.appendChild(attachFace);
  attachCell.append(attachLed, attach);
  attach.addEventListener("click", () => {
    const t = window.__TAURI__;
    const reset = () => { attachCell.classList.remove("busy", "failed"); attach.title = "attach in terminal"; };
    if (t && t.core) {
      attachCell.classList.add("busy");
      attach.title = "attaching…";
      t.core.invoke("attach_terminal", { project: s.project, name: s.name })
        .then(reset)
        .catch(() => {
          attachCell.classList.remove("busy");
          attachCell.classList.add("failed");
          attach.title = "attach failed";
          setTimeout(reset, 2000);
        });
    } else {
      attach.title = "dex attach " + s.name;
    }
  });
  titleRow.appendChild(attachCell);
  head.appendChild(titleRow);

  const phaseWrap = el("div", "d-phase");
  phaseWrap.appendChild(renderRail(s.phase));
  const label = el("span", "phase-label");
  label.textContent = s.phase;
  phaseWrap.appendChild(label);
  head.appendChild(phaseWrap);

  root.appendChild(head);
  root.appendChild(renderState(s));

  // Live team panes panel: populated by the poller below; hidden when empty.
  const teamWrap = el("div", "d-team-panes");
  root.appendChild(teamWrap);
  TEAM_PANES_WRAP = teamWrap;

  root.appendChild(renderDetailPanel(detail));

  // Poll pane content while the detail is open; stop on navigate-away.
  stopTeamPoll();
  loadTeamPanes(s.project, s.name).then((result) => updateTeamPanesPanel(result, s.project, s.name));
  TEAM_POLL_TIMER = setInterval(() => {
    if (!document.getElementById("detail").hidden) {
      loadTeamPanes(s.project, s.name).then((result) => updateTeamPanesPanel(result, s.project, s.name));
    }
  }, 1500);
}

let DETAIL_TAB = "events";

// One panel, four sources: the event log, spec.md, logbook.md, and the project's
// .dex.toml — switched by a row of drams push-buttons.
function renderDetailPanel(detail) {
  const wrap = el("div", "d-panel");

  const tabs = el("div", "d-tabs");
  [
    ["events", "events.json"],
    ["spec", "spec.md"],
    ["logbook", "logbook.md"],
    ["config", ".dex.toml"],
  ].forEach(([key, lbl]) => {
    const b = el("button", "d-tab" + (DETAIL_TAB === key ? " active" : ""));
    b.type = "button";
    b.textContent = lbl;
    b.setAttribute("aria-selected", DETAIL_TAB === key ? "true" : "false");
    b.addEventListener("click", () => {
      DETAIL_TAB = key;
      renderDetail(CURRENT_DETAIL);
    });
    tabs.appendChild(b);
  });
  wrap.appendChild(tabs);

  if (DETAIL_TAB === "events") wrap.appendChild(renderTimeline(detail.events || []));
  else if (DETAIL_TAB === "spec") {
    if (detail.doc && detail.doc.trim()) wrap.appendChild(renderMarkdown(detail.doc));
    else { const p = el("p", "md-empty"); p.textContent = "No spec.md for this spec."; wrap.appendChild(p); }
  } else if (DETAIL_TAB === "logbook") {
    if (detail.logbook && detail.logbook.trim()) wrap.appendChild(renderMarkdown(detail.logbook));
    else { const p = el("p", "md-empty"); p.textContent = "No logbook.md for this spec."; wrap.appendChild(p); }
  } else {
    wrap.appendChild(renderTomlDoc(detail.config_raw));
  }

  return wrap;
}

// The project's verbatim .dex.toml, line-tinted. Highlighting is per line and
// strings are wrapped before the key so the key span's attribute quotes are
// never re-scanned (the cause of an earlier mangled render).
function renderTomlDoc(raw) {
  const pre = el("pre", "toml-doc");
  if (!raw || !raw.trim()) {
    pre.classList.add("empty");
    pre.textContent = "No .dex.toml for this project.";
    return pre;
  }
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  pre.innerHTML = raw.split("\n").map((line) => {
    const e = esc(line);
    if (/^\s*#/.test(e)) return `<span class="tk-comment">${e}</span>`;
    if (/^\s*\[/.test(e)) return `<span class="tk-section">${e}</span>`;
    return e
      .replace(/"[^"]*"/g, (m) => `<span class="tk-str">${m}</span>`)
      .replace(/^(\s*)([\w.-]+)(\s*=)/, '$1<span class="tk-key">$2</span>$3');
  }).join("\n");
  return pre;
}

function renderMarkdown(text) {
  const div = el("div", "md-doc");
  if (!text || !text.trim()) return div;

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escAttr = (s) => esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const safeUrl = (url) => /^(https?:|mailto:|\/|#|\.)/.test(url) || !url.includes(":");

  const inlineSpans = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => {
        if (!safeUrl(url)) return txt;
        const guard = window.__TAURI__ ? ' onclick="event.preventDefault()"' : "";
        return `<a href="${escAttr(url)}"${guard}>${txt}</a>`;
      });

  const lines = text.split("\n");
  let i = 0;
  let listStack = [];

  const flushLists = () => {
    while (listStack.length) {
      div.appendChild(listStack.pop());
    }
  };

  const getOrCreateList = (tag) => {
    if (listStack.length && listStack[listStack.length - 1].tagName.toLowerCase() === tag) {
      return listStack[listStack.length - 1];
    }
    flushLists();
    const lst = document.createElement(tag);
    listStack.push(lst);
    return lst;
  };

  while (i < lines.length) {
    const line = lines[i];

    const fenceMatch = line.match(/^```/);
    if (fenceMatch) {
      flushLists();
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].match(/^```/)) {
        codeLines.push(esc(lines[i]));
        i++;
      }
      i++;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.innerHTML = codeLines.join("\n");
      pre.appendChild(code);
      div.appendChild(pre);
      continue;
    }

    const hMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (hMatch) {
      flushLists();
      const level = hMatch[1].length;
      const h = document.createElement("h" + level);
      h.innerHTML = inlineSpans(hMatch[2]);
      div.appendChild(h);
      i++;
      continue;
    }

    if (/^---+$|^\*\*\*+$/.test(line)) {
      flushLists();
      div.appendChild(document.createElement("hr"));
      i++;
      continue;
    }

    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      flushLists();
      const bq = document.createElement("blockquote");
      const p = document.createElement("p");
      p.innerHTML = inlineSpans(bqMatch[1]);
      bq.appendChild(p);
      div.appendChild(bq);
      i++;
      continue;
    }

    const taskMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)/);
    if (taskMatch) {
      const lst = getOrCreateList("ul");
      const li = document.createElement("li");
      li.className = "task-item";
      const checked = taskMatch[1].toLowerCase() === "x";
      li.innerHTML = `<span class="task-box">${checked ? "☑" : "☐"}</span> ${inlineSpans(taskMatch[2])}`;
      lst.appendChild(li);
      i++;
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.*)/);
    if (ulMatch) {
      const lst = getOrCreateList("ul");
      const li = document.createElement("li");
      li.innerHTML = inlineSpans(ulMatch[1]);
      lst.appendChild(li);
      i++;
      continue;
    }

    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      const lst = getOrCreateList("ol");
      const li = document.createElement("li");
      li.innerHTML = inlineSpans(olMatch[1]);
      lst.appendChild(li);
      i++;
      continue;
    }

    if (line.trim() === "") {
      flushLists();
      i++;
      continue;
    }

    flushLists();
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].match(/^(#{1,6}\s|```|---+|\*\*\*+|>|[-*]\s|\d+\.\s)/)) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      const p = document.createElement("p");
      p.innerHTML = paraLines.map(inlineSpans).join("<br>");
      div.appendChild(p);
    }
  }

  flushLists();
  return div;
}

// ============================ signals ============================

async function loadAndRenderSignals() {
  let notes;
  const t = window.__TAURI__;
  if (t && t.core) {
    notes = await t.core.invoke("signals").catch(() => []);
  } else {
    notes = SAMPLE_SIGNALS;
  }
  LAST_SIGNALS = notes || [];
  renderSignals(LAST_SIGNALS);
}

function renderSignals(notes) {
  const root = document.getElementById("signals");
  if (!root) return;
  root.textContent = "";

  const filtered = SIGNALS_SCOPE_FILTER === "all"
    ? notes
    : notes.filter((n) => n.scope === SIGNALS_SCOPE_FILTER);

  if (filtered.length === 0) {
    const empty = el("div", "sig-empty");
    empty.textContent = SIGNALS_SCOPE_FILTER === "all"
      ? "No notes yet. Agents emit notes with \`dex note --scope skill|project|spec …\`."
      : "No notes with scope “" + SIGNALS_SCOPE_FILTER + "” yet.";
    root.appendChild(empty);
    return;
  }

  const byTopic = new Map();
  filtered.forEach((n) => {
    if (!byTopic.has(n.topic)) byTopic.set(n.topic, []);
    byTopic.get(n.topic).push(n);
  });
  const sortedTopics = [...byTopic.keys()].sort();

  sortedTopics.forEach((topic) => {
    const group = el("div", "sig-group");

    const header = el("div", "sig-topic-head");
    const topicLabel = el("span", "sig-topic-name");
    topicLabel.textContent = topic;
    const count = el("span", "sig-topic-count");
    count.textContent = byTopic.get(topic).length;
    header.appendChild(topicLabel);
    header.appendChild(count);
    group.appendChild(header);

    const rows = [...byTopic.get(topic)].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    rows.forEach((n) => {
      const row = el("div", "sig-row");
      row.dataset.level = n.level;

      const meta = el("div", "sig-meta");
      const spec = el("span", "sig-spec");
      spec.textContent = n.project + "/" + n.spec;
      spec.title = n.project + "/" + n.spec;
      meta.appendChild(spec);

      if (n.actor) {
        const actor = el("span", "sig-actor");
        actor.textContent = n.actor;
        meta.appendChild(actor);
      }

      if (n.scope) {
        const scope = el("span", "sig-scope-tag");
        scope.textContent = n.scope;
        meta.appendChild(scope);
      }

      const time = el("span", "sig-time");
      time.textContent = relTime(n.time);
      time.title = n.time || "";
      meta.appendChild(time);

      row.appendChild(meta);

      const body = el("div", "sig-body");
      const dot = el("span", "sig-dot");
      dot.dataset.level = n.level;
      body.appendChild(dot);
      const text = el("span", "sig-text");
      text.textContent = n.text;
      body.appendChild(text);
      row.appendChild(body);

      group.appendChild(row);
    });

    root.appendChild(group);
  });
}

// ============================ curator ============================

async function loadAndRenderCurator() {
  const root = document.getElementById("curator");
  if (!root) return;
  root.textContent = "";

  let reports = [];
  const t = window.__TAURI__;
  if (t && t.core) {
    reports = await t.core.invoke("curator_reports").catch(() => []);
  }

  const rail = el("div", "curator-rail");
  const pane = el("div", "curator-pane");
  root.appendChild(rail);
  root.appendChild(pane);

  if (!reports || reports.length === 0) {
    const empty = el("div", "curator-empty");
    empty.textContent = "No curator reports yet. Run /specdex curate to generate one.";
    rail.appendChild(empty);
    return;
  }

  async function selectReport(id, btn) {
    rail.querySelectorAll(".curator-run").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    let md = "";
    if (t && t.core) {
      md = await t.core.invoke("read_curator_report", { id }).catch(() => "");
    }
    pane.textContent = "";
    if (md) {
      pane.appendChild(renderMarkdown(md));
    } else {
      const empty = el("div", "curator-pane-empty");
      empty.textContent = "No content.";
      pane.appendChild(empty);
    }
  }

  reports.forEach((r, i) => {
    const btn = el("button", "curator-run");
    btn.type = "button";
    const label = el("span", "curator-run-label");
    label.textContent = relTime(r.time);
    label.title = r.time || "";
    btn.appendChild(label);
    btn.addEventListener("click", () => selectReport(r.id, btn));
    rail.appendChild(btn);
    if (i === 0) selectReport(r.id, btn);
  });
}

// ============================ routing ============================

function showView(view) {
  const onFleet = view === "fleet";
  const onSignals = view === "signals";
  const onCurator = view === "curator";
  const legend = document.getElementById("legend");
  const controls = document.getElementById("fleet-controls");
  const sigControls = document.getElementById("signals-controls");
  const listwrap = document.getElementById("listwrap");
  const signalsEl = document.getElementById("signals");
  const curatorEl = document.getElementById("curator");

  if (legend) legend.hidden = !onFleet;
  if (controls) controls.hidden = !onFleet;
  if (sigControls) sigControls.hidden = !onSignals;
  document.getElementById("detail").hidden = view !== "detail";
  if (signalsEl) signalsEl.hidden = !onSignals;
  if (curatorEl) curatorEl.hidden = !onCurator;

  if (!onFleet) {
    document.getElementById("fleet").hidden = true;
    listwrap.hidden = true;
  } else {
    document.getElementById("fleet").hidden = LAYOUT !== "cards";
    listwrap.hidden = LAYOUT !== "list";
  }

  const navAgents = document.getElementById("nav-agents");
  const navSignals = document.getElementById("nav-signals");
  const navCurator = document.getElementById("nav-curator");
  if (navAgents) navAgents.setAttribute("aria-selected", onFleet ? "true" : "false");
  if (navSignals) navSignals.setAttribute("aria-selected", onSignals ? "true" : "false");
  if (navCurator) navCurator.setAttribute("aria-selected", onCurator ? "true" : "false");
}

async function loadDetail(project, name) {
  const t = window.__TAURI__;
  if (t && t.core) {
    try {
      return await t.core.invoke("spec_detail", { project, name });
    } catch (_) { /* fall through to sample */ }
  }
  return sampleDetail(project, name);
}

async function navigate(route) {
  stopTeamPoll(); // stop any active team-panes polling before navigating
  TEAM_PANES_WRAP = null;
  if (route.view === "detail") {
    HEARTBEATS_EXPANDED = false;
    DETAIL_TAB = "events";
    SB_EXPANDED.add(route.project); // surface the open spec's project config
    const detail = await loadDetail(route.project, route.name);
    renderDetail(detail);
    showView("detail");
    renderSidebar(LAST_FLEET);
    location.hash = "#/spec/" + encodeURIComponent(route.project) + "/" + encodeURIComponent(route.name);
  } else if (route.view === "signals") {
    CURRENT_DETAIL = null;
    await loadAndRenderSignals();
    showView("signals");
    renderSidebar(LAST_FLEET);
    location.hash = "#/signals";
  } else if (route.view === "curator") {
    CURRENT_DETAIL = null;
    await loadAndRenderCurator();
    showView("curator");
    renderSidebar(LAST_FLEET);
    location.hash = "#/curator";
  } else {
    showView("fleet");
    location.hash = "";
    CURRENT_DETAIL = null;
    renderSidebar(LAST_FLEET);
  }
  window.scrollTo(0, 0);
}

function routeFromHash() {
  if (location.hash === "#/signals") { navigate({ view: "signals" }); return; }
  if (location.hash === "#/curator") { navigate({ view: "curator" }); return; }
  const m = location.hash.match(/^#\/spec\/([^/]+)\/([^/]+)$/);
  if (m) navigate({ view: "detail", project: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) });
  else showView("fleet");
}

// ============================ theme ============================

const THEME_ICON = {
  system: ICONS.system,
  light: ICONS.sun,
  dark: ICONS.moon,
};
const THEME_ORDER = ["system", "light", "dark"];

function applyTheme(state) {
  const resolved = state === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : state;
  document.documentElement.dataset.theme = resolved;
  const btn = document.getElementById("theme-toggle");
  btn.dataset.state = state;
  btn.setAttribute("aria-label", "Theme: " + state);
  btn.title = "Theme: " + state + " (click to cycle)";
  const knob = document.getElementById("t-knob");
  if (knob) knob.innerHTML = THEME_ICON[state] || "";
}

function initTheme() {
  const saved = localStorage.dexTheme;
  let state = THEME_ORDER.includes(saved) ? saved : "system";
  applyTheme(state);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    state = THEME_ORDER[(THEME_ORDER.indexOf(state) + 1) % THEME_ORDER.length];
    localStorage.dexTheme = state;
    applyTheme(state);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.dexTheme || "system") === "system") applyTheme("system");
  });
}

// ============================ boot ============================

function initFleetSort() {
  const group = document.getElementById("fleet-sort");
  if (!group) return;
  const buttons = group.querySelectorAll("button[data-sort]");
  const paint = () =>
    buttons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.sort === FLEET_SORT ? "true" : "false"));
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      FLEET_SORT = b.dataset.sort;
      localStorage.dexFleetSort = FLEET_SORT;
      paint();
      renderFleet(LAST_FLEET);
    })
  );
  paint();
}

function initSignalsScope() {
  const group = document.getElementById("signals-scope");
  if (!group) return;
  const buttons = group.querySelectorAll("button[data-scope]");
  const paint = () =>
    buttons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.scope === SIGNALS_SCOPE_FILTER ? "true" : "false"));
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      SIGNALS_SCOPE_FILTER = b.dataset.scope;
      paint();
      renderSignals(LAST_SIGNALS);
    })
  );
  paint();
}

function initLayoutToggle() {
  const group = document.getElementById("layout-toggle");
  if (!group) return;
  const buttons = group.querySelectorAll("button[data-layout]");
  const paint = () =>
    buttons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.layout === LAYOUT ? "true" : "false"));
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      LAYOUT = b.dataset.layout;
      localStorage.dexFleetLayout = LAYOUT;
      paint();
      renderFleet(LAST_FLEET);
    })
  );
  paint();
}

function boot() {
  document.getElementById("brand-home").addEventListener("click", (e) => {
    e.preventDefault();
    navigate({ view: "fleet" });
  });

  const navAgents = document.getElementById("nav-agents");
  const navSignals = document.getElementById("nav-signals");
  const navCurator = document.getElementById("nav-curator");
  if (navAgents) navAgents.addEventListener("click", () => navigate({ view: "fleet" }));
  if (navSignals) navSignals.addEventListener("click", () => navigate({ view: "signals" }));
  if (navCurator) navCurator.addEventListener("click", () => navigate({ view: "curator" }));

  initLayoutToggle();
  initFleetSort();
  initSignalsScope();
  window.addEventListener("hashchange", routeFromHash);

  const t = window.__TAURI__;
  if (t && t.core && t.event) {
    t.core.invoke("fleet").then(renderFleet).catch(() => renderFleet([]));
    t.event.listen("fleet", (e) => {
      renderFleet(e.payload || []);
      if (CURRENT_DETAIL && !document.getElementById("detail").hidden) {
        // fleet payload only repaints the list; re-pull the open spec for live detail
        loadDetail(CURRENT_DETAIL.state.project, CURRENT_DETAIL.state.name).then(renderDetail);
      }
    });
    t.event.listen("signals", (e) => {
      LAST_SIGNALS = e.payload || [];
      if (!document.getElementById("signals").hidden) {
        renderSignals(LAST_SIGNALS);
      }
    });
  } else {
    renderFleet(FLEET); // standalone prototype (opened directly in a browser)
  }

  routeFromHash();
  setInterval(tickLiveness, TICK_MS);
  setInterval(() => {
    if (LAYOUT === "list" && !document.getElementById("listwrap").hidden) {
      renderFleet(LAST_FLEET);
    }
  }, 15_000);
}

initTheme();
boot();
