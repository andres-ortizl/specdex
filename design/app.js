// specdex prototype — renders a fleet of minions from hardcoded FleetRow samples.
// Vanilla JS, no framework, no build step. Mirrors crates/core/src/view.rs::FleetRow.

const PHASES = [
  "setup", "plan", "build", "review", "ship", "verify", "complete", "accepted",
];

// ~6 sample minions covering every health state and several phases.
const FLEET = [
  {
    project: "anyformat-backend", name: "parse-cache", phase: "build",
    health: "alive",
    agents: [{ role: "coder", active: true }, { role: "reviewer", active: false }],
    pr: null, blocked_reason: null, review_round: 0, review_score: null, offset: 4,
  },
  {
    project: "anyformat-backend", name: "timeseries-perf", phase: "review",
    health: "alive",
    agents: [{ role: "coder", active: false }, { role: "reviewer", active: true }],
    pr: 3998, blocked_reason: null, review_round: 1, review_score: null, offset: 8,
  },
  {
    project: "specdex", name: "fleet-watch", phase: "plan",
    health: "idle",
    agents: [{ role: "coder", active: false }],
    pr: null, blocked_reason: null, review_round: 0, review_score: null, offset: 0,
  },
  {
    project: "anyformat-frontend", name: "results-virtualize", phase: "build",
    health: "stale",
    agents: [{ role: "coder", active: false }],
    pr: null, blocked_reason: null, review_round: 0, review_score: null, offset: 12,
  },
  {
    project: "anyformat-backend", name: "verify-flake", phase: "verify",
    health: "needs-you",
    agents: [{ role: "coder", active: true }, { role: "reviewer", active: false }],
    pr: 4012, blocked_reason: "infra flake on CI — needs a human re-run",
    review_round: 2, review_score: 4, offset: 20,
  },
  {
    project: "anyformat-sdk", name: "typed-create-proxy", phase: "accepted",
    health: "done",
    agents: [],
    pr: 3990, blocked_reason: null, review_round: 1, review_score: 5, offset: 0,
  },
];

const PHASE_INDEX = Object.fromEntries(PHASES.map((p, i) => [p, i]));

const ICONS = {
  flag:
    '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 21V4M4 4h12l-2 4 2 4H4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sun:
    '<svg viewBox="0 0 24 24" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" stroke-linecap="round"/></svg>',
  moon:
    '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M21 12.5A8.5 8.5 0 1 1 11.5 3a6.5 6.5 0 0 0 9.5 9.5z" stroke-linejoin="round"/></svg>',
  system:
    '<svg viewBox="0 0 24 24" stroke-width="1.8"><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4" stroke-linecap="round"/></svg>',
};

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function renderRail(currentPhase) {
  const rail = el("div", "rail");
  const cur = PHASE_INDEX[currentPhase] ?? 0;
  PHASES.forEach((phase, i) => {
    if (i > 0) {
      const link = el("span", "rail-link" + (i <= cur ? " done" : ""));
      rail.appendChild(link);
    }
    let cls = "rail-node";
    if (i < cur) cls += " done";
    else if (i === cur) cls += " current";
    const node = el("span", cls);
    node.title = phase;
    rail.appendChild(node);
  });
  return rail;
}

function renderMinion(row) {
  const card = el("article", "minion");
  card.dataset.health = row.health;
  card.dataset.phase = row.phase;

  // head: life-dot + name + pr + project
  const head = el("div", "m-head");
  head.appendChild(el("span", "life-dot"));

  const name = el("span", "m-name");
  name.textContent = row.name;
  name.title = row.name;
  head.appendChild(name);

  if (row.pr != null) {
    const pr = el("a", "m-pr");
    pr.textContent = "PR " + row.pr;
    pr.href = "#";
    pr.title = "Pull request #" + row.pr;
    head.appendChild(pr);
  } else {
    head.appendChild(el("span")); // keep grid columns aligned
  }

  const project = el("span", "m-project");
  project.textContent = row.project;
  project.title = row.project;
  head.appendChild(project);
  card.appendChild(head);

  // phase rail + label
  const phaseWrap = el("div", "m-phase");
  phaseWrap.appendChild(renderRail(row.phase));
  const label = el("span", "phase-label");
  label.textContent = row.phase;
  phaseWrap.appendChild(label);
  card.appendChild(phaseWrap);

  // footer: agents + review meta
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

  // blocked reason — needs-you only
  if (row.health === "needs-you" && row.blocked_reason) {
    const blocked = el("div", "m-blocked");
    blocked.innerHTML = ICONS.flag;
    blocked.appendChild(document.createTextNode(row.blocked_reason));
    card.appendChild(blocked);
  }

  return card;
}

function renderFleet(rows) {
  const root = document.getElementById("fleet");
  root.textContent = "";
  // sort: project then name, matching fleet_snapshot() in view.rs
  const sorted = [...rows].sort(
    (a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name)
  );
  sorted.forEach((row, i) => {
    const card = renderMinion(row);
    card.style.animationDelay = i * 40 + "ms";
    root.appendChild(card);
  });
  document.getElementById("fleet-count").textContent =
    rows.length + (rows.length === 1 ? " spec" : " specs");
}

// ---- theme toggle: system → light → dark → system ----

function applyTheme(state) {
  const resolved =
    state === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      : state;
  document.documentElement.dataset.theme = resolved;
  const btn = document.getElementById("theme-toggle");
  const icon = document.getElementById("theme-icon");
  icon.innerHTML = ICONS[state === "system" ? "system" : resolved];
  btn.title = "Theme: " + state;
}

function initTheme() {
  let state = localStorage.dexTheme || "system";
  applyTheme(state);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    state = state === "system" ? "light" : state === "light" ? "dark" : "system";
    localStorage.dexTheme = state;
    applyTheme(state);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.dexTheme || "system") === "system") applyTheme("system");
  });
}

initTheme();
renderFleet(FLEET);
