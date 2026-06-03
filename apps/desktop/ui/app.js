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

// Sample spec_detail payloads, keyed "project/name", for the standalone prototype.
function sampleDetail(project, name) {
  const t = (ms) => ISO(ms);
  if (project === "anyformat-backend" && name === "verify-flake") {
    return {
      health: "needs-you",
      state: {
        project, name, phase: "verify", mode: "autonomous", branch: "verify-flake",
        worktree: "~/code/anyformat-backend.worktrees/verify-flake",
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
        { type: "spec.created", time: t(95 * 60_000), source: "dex",
          data: { branch: "verify-flake", worktree: "~/code/anyformat-backend.worktrees/verify-flake" } },
        { type: "ports.assigned", time: t(95 * 60_000), source: "dex",
          data: { offset: 20, ports: { backend: 8020, frontend: 5193, db: 5452 } } },
        { type: "phase.enter", time: t(94 * 60_000), source: "coder", data: { phase: "plan" } },
        { type: "agent.spawn", time: t(93 * 60_000), source: "dex", data: { role: "coder", agent_id: "c-7a1" } },
        { type: "phase.enter", time: t(80 * 60_000), source: "coder", data: { phase: "build" } },
        { type: "heartbeat", time: t(78 * 60_000), source: "coder", data: {} },
        { type: "heartbeat", time: t(76 * 60_000), source: "coder", data: {} },
        { type: "heartbeat", time: t(74 * 60_000), source: "coder", data: {} },
        { type: "test.result", time: t(60 * 60_000), source: "coder",
          data: { passed: 320, failed: 0, cmd: "pytest -q" } },
        { type: "phase.enter", time: t(58 * 60_000), source: "coder", data: { phase: "review" } },
        { type: "agent.spawn", time: t(57 * 60_000), source: "dex", data: { role: "reviewer", agent_id: "r-3c9" } },
        { type: "review.verdict", time: t(45 * 60_000), source: "reviewer",
          data: { round: 1, verdict: "changes_requested", blockers: 1, issues: 3 } },
        { type: "note", time: t(44 * 60_000), source: "reviewer",
          data: { level: "warn", topic: "perf", text: "N+1 query in the results serializer" } },
        { type: "phase.enter", time: t(30 * 60_000), source: "coder", data: { phase: "build", reason: "addressing review" } },
        { type: "review.verdict", time: t(20 * 60_000), source: "reviewer",
          data: { round: 2, verdict: "approved", blockers: 0, issues: 0 } },
        { type: "agent.idle", time: t(20 * 60_000), source: "reviewer", data: { role: "reviewer" } },
        { type: "pr.created", time: t(18 * 60_000), source: "dex",
          data: { number: 4012, url: "https://github.com/anyformat-ai/anyformat-backend/pull/4012" } },
        { type: "phase.enter", time: t(16 * 60_000), source: "coder", data: { phase: "verify" } },
        { type: "gate.status", time: t(14 * 60_000), source: "github-actions",
          data: { provider: "github-actions", name: "ci", result: "failure" } },
        { type: "test.result", time: t(13 * 60_000), source: "coder",
          data: { passed: 318, failed: 2, cmd: "pytest -q" } },
        { type: "spec.blocked", time: t(12 * 60_000), source: "dex",
          data: { reason: "infra flake on CI — needs a human re-run" } },
      ],
      doc: "# verify-flake\n\nStabilize the flaky results-serializer test under CI load.\n\n## Acceptance Criteria\n- [ ] test passes 50× in a row locally\n- [ ] no N+1 query in the results serializer\n",
      logbook: "# verify-flake — logbook\n\nStatus: BLOCKED\n\n- 95m ago — spec created, worktree + ports assigned\n- 80m ago — build started (coder c-7a1)\n- 60m ago — tests green (320 passed)\n- 45m ago — review round 1: changes requested (1 blocker, 3 issues)\n- 30m ago — addressing review feedback\n- 20m ago — review round 2: approved\n- 18m ago — PR #4012 created\n- 14m ago — CI gate failed (infra flake)\n- 12m ago — BLOCKED: needs a human CI re-run\n",
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
      { type: "spec.created", time: ISO(60 * 60_000), source: "dex",
        data: { branch: name, worktree: "~/code/" + project + ".worktrees/" + name } },
      { type: "phase.enter", time: ISO(58 * 60_000), source: "coder", data: { phase: "plan" } },
      { type: "agent.spawn", time: ISO(57 * 60_000), source: "dex", data: { role: "coder" } },
      { type: "phase.enter", time: ISO(40 * 60_000), source: "coder", data: { phase: row.phase } },
      { type: "heartbeat", time: ISO(20 * 60_000), source: "coder", data: {} },
      { type: "heartbeat", time: ISO(15 * 60_000), source: "coder", data: {} },
      { type: "note", time: ISO(10 * 60_000), source: "coder",
        data: { level: "info", topic: "status", text: "working through the " + row.phase + " step" } },
    ],
    doc: row.mode === "collaborative"
      ? "# " + name + "\n\nHuman-driven session — planning live with the lead.\n"
      : null,
    logbook: "# " + name + " — logbook\n\nStatus: " + row.phase.toUpperCase() + "\n\n- 60m ago — spec created\n- 40m ago — entered " + row.phase + "\n- 10m ago — working through the " + row.phase + " step\n",
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

function renderRail(currentPhase) {
  const rail = el("div", "rail");
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
  head.appendChild(el("span", "life-dot"));

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
  phaseWrap.appendChild(renderRail(row.phase));
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

let LAST_FLEET = [];

// Sidebar state: which projects are expanded + per-project raw-toml cache.
// SB_TOML: undefined = not fetched, "loading", null = none, or raw toml string.
const SB_EXPANDED = new Set();
const SB_TOML = {};

function renderFleet(rows) {
  LAST_FLEET = rows || [];
  renderSidebar(LAST_FLEET);
  const root = document.getElementById("fleet");
  root.textContent = "";
  const count = document.getElementById("fleet-count");
  if (!rows || rows.length === 0) {
    const empty = el(
      "div", null,
      'No active specs yet.<br><span style="font-size:13px">Start one with <code>/spec</code> — minions appear here as they run.</span>'
    );
    empty.style.cssText =
      "grid-column:1/-1;color:var(--ink-faint);text-align:center;padding:56px 8px;line-height:1.7";
    root.appendChild(empty);
    count.textContent = "0 specs";
    return;
  }
  const sorted = [...rows].sort(
    (a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name)
  );
  sorted.forEach((row, i) => {
    const card = renderMinion(row);
    card.style.animationDelay = i * 40 + "ms";
    root.appendChild(card);
  });
  count.textContent = rows.length + (rows.length === 1 ? " spec" : " specs");
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
      loadTomlIfNeeded(project);
    }
    root.appendChild(section);
  });
}

function hlToml(raw) {
  const esc = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc.split("\n").map((line) => {
    if (/^\s*#/.test(line)) return `<span class="tk-comment">${line}</span>`;
    if (/^\s*\[/.test(line)) return `<span class="tk-section">${line}</span>`;
    return line
      .replace(/^(\s*[\w.-]+\s*=\s*)/, '<span class="tk-key">$1</span>')
      .replace(/"([^"]*)"/g, '"<span class="tk-str">$1</span>"');
  }).join("\n");
}

function renderConfig(project) {
  const toml = SB_TOML[project];
  if (toml === undefined || toml === "loading") {
    const wrap = el("div", "sb-config muted");
    wrap.textContent = "loading…";
    return wrap;
  }
  if (!toml) {
    const wrap = el("div", "sb-config muted");
    wrap.textContent = "none";
    return wrap;
  }
  const pre = el("pre", "sb-toml");
  pre.innerHTML = hlToml(toml);
  return pre;
}

async function loadProjectConfigRaw(project) {
  const t = window.__TAURI__;
  if (t && t.core) {
    try { return await t.core.invoke("project_config_raw", { project }); }
    catch (_) { return null; }
  }
  return sampleConfigRaw(project);
}

function loadTomlIfNeeded(project) {
  if (SB_TOML[project] !== undefined) return;
  SB_TOML[project] = "loading";
  loadProjectConfigRaw(project)
    .then((raw) => { SB_TOML[project] = raw || null; renderSidebar(LAST_FLEET); })
    .catch(() => { SB_TOML[project] = null; renderSidebar(LAST_FLEET); });
}

// ============================ detail ============================

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

  const time = el("span", "tl-time");
  time.textContent = fmtUTC(ev.time);
  time.title = ev.time + (ev.source ? "  ·  " + ev.source : "");
  row.appendChild(time);

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
  back.appendChild(document.createTextNode("fleet"));
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

  const attach = el("button", "d-attach");
  attach.type = "button";
  attach.innerHTML = ICONS.terminal;
  attach.appendChild(document.createTextNode("attach in terminal"));
  attach.addEventListener("click", () => {
    const t = window.__TAURI__;
    if (t && t.core) {
      attach.lastChild.textContent = "attaching…";
      t.core.invoke("attach_terminal", { project: s.project, name: s.name })
        .then(() => { attach.lastChild.textContent = "attach in terminal"; })
        .catch(() => {
          attach.lastChild.textContent = "attach failed";
          setTimeout(() => { attach.lastChild.textContent = "attach in terminal"; }, 2000);
        });
    } else {
      attach.lastChild.textContent = "dex attach " + s.name;
    }
  });
  titleRow.appendChild(attach);
  head.appendChild(titleRow);

  const phaseWrap = el("div", "d-phase");
  phaseWrap.appendChild(renderRail(s.phase));
  const label = el("span", "phase-label");
  label.textContent = s.phase;
  phaseWrap.appendChild(label);
  head.appendChild(phaseWrap);

  root.appendChild(head);
  root.appendChild(renderState(s));
  root.appendChild(renderDetailPanel(detail));
}

let DETAIL_TAB = "events";

// One panel, three sources: the event log, spec.md, logbook.md — switched by a
// row of drams push-buttons.
function renderDetailPanel(detail) {
  const wrap = el("div", "d-panel");

  const tabs = el("div", "d-tabs");
  [
    ["events", "events.json"],
    ["spec", "spec.md"],
    ["logbook", "logbook.md"],
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
  } else {
    if (detail.logbook && detail.logbook.trim()) wrap.appendChild(renderMarkdown(detail.logbook));
    else { const p = el("p", "md-empty"); p.textContent = "No logbook.md for this spec."; wrap.appendChild(p); }
  }

  return wrap;
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

// ============================ routing ============================

function showView(view) {
  document.getElementById("fleet").hidden = view !== "fleet";
  document.getElementById("detail").hidden = view !== "detail";
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
  if (route.view === "detail") {
    HEARTBEATS_EXPANDED = false;
    DETAIL_TAB = "events";
    SB_EXPANDED.add(route.project); // surface the open spec's project config
    const detail = await loadDetail(route.project, route.name);
    renderDetail(detail);
    showView("detail");
    renderSidebar(LAST_FLEET);
    location.hash = "#/spec/" + encodeURIComponent(route.project) + "/" + encodeURIComponent(route.name);
  } else {
    showView("fleet");
    location.hash = "";
    CURRENT_DETAIL = null;
    renderSidebar(LAST_FLEET);
  }
  window.scrollTo(0, 0);
}

function routeFromHash() {
  const m = location.hash.match(/^#\/spec\/([^/]+)\/([^/]+)$/);
  if (m) navigate({ view: "detail", project: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) });
  else showView("fleet");
}

// ============================ theme ============================

function applyTheme(state) {
  document.documentElement.dataset.theme = state;
  const btn = document.getElementById("theme-toggle");
  btn.setAttribute("aria-pressed", state === "dark" ? "true" : "false");
  btn.title = "Theme: " + state;
}

function initTheme() {
  // drams' identity lives in warm-paper light — a 2-position switch: light ↔ dark.
  let state = localStorage.dexTheme === "dark" ? "dark" : "light";
  applyTheme(state);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    state = state === "dark" ? "light" : "dark";
    localStorage.dexTheme = state;
    applyTheme(state);
  });
}

// ============================ boot ============================

function boot() {
  document.getElementById("brand-home").addEventListener("click", (e) => {
    e.preventDefault();
    navigate({ view: "fleet" });
  });
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
  } else {
    renderFleet(FLEET); // standalone prototype (opened directly in a browser)
  }

  routeFromHash();
  setInterval(tickLiveness, TICK_MS);
}

initTheme();
boot();
