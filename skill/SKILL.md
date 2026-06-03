---
name: spec
description: "End-to-end feature development loop. You describe a feature, iterate on the plan, then the team implements, reviews, creates PR, and handles Greptile feedback autonomously. DMs you at milestones. Use ONLY when the user wants the full autonomous implement→review→PR→CI→Greptile loop for a multi-file feature. Do NOT use for: quick bug fixes, single-file edits, exploratory/discussion tasks, or anything the user wants to drive step-by-step."
triggers:
  - spec
---

# Spec: End-to-End Feature Development

You are the lead/coordinator of a development team. You plan with the user, then create a team of agents (coder, reviewer) to drive a feature from approved plan to merged PR.

## The Loop

```
User describes feature
        │
        ▼
┌─ SETUP ──────────────────┐
│  Create .spec/<name>/     │
│  Enter worktree            │
│  Copy .spec-env → .env    │
│  Set ports + project name  │
└───────┬────────────────────┘
        ▼
┌─ PLAN (interactive) ─────┐
│  Lead enters plan mode     │
│  User iterates directly    │
│  with lead until approved  │
└───────┬────────────────────┘
        │ plan approved
        ▼
┌─ IMPLEMENT (autonomous) ─┐
│  Coder implements plan    │
│  TDD: RED → GREEN         │
│  Parallelizes independent │
│  chunks via sub-agents    │
│  STAYS ALIVE for feedback │
└───────┬───────────────────┘
        │ reports done
        ▼
┌─ REVIEW (autonomous) ────┐
│  Reviewer checks code     │
│  PASS → continue          │
│  FAIL → send findings to  │
│  coder via SendMessage    │
│  Loop until PASS (max 3)  │
└───────┬───────────────────┘
        │ PASS
        ▼
┌─ SHIP (autonomous) ──────┐
│  /pr skill: commit, push, │
│  create PR                │
└───────┬───────────────────┘
        │ PR created
        ▼
┌─ CI WATCH (autonomous) ──┐
│  Poll pipeline checks     │
│  Easy fix → commit + push │
│  Hard fix → DM user + stop│
│  Loop until all green     │
└───────┬───────────────────┘
        │ CI green
        ▼
┌─ GREPTILE (autonomous) ──┐
│  Wait for Greptile review │
│  /react-to-greptile skill │
│  DM user every round      │
│  Loop until score ≥ 5/5   │
└───────┬───────────────────┘
        │ done
        ▼
      COMPLETE
```

## Event emission (dex)

The `dex` CLI records a structured event stream per spec under
`~/.spec/<project-name>/<spec-name>/` (`events.jsonl` + a derived `state.json`) —
the machine-readable feed the fleet view and the global watcher read. It runs
*alongside* the logbook and Slack DMs, replacing neither.

**At every milestone where you log or DM, ALSO run the matching `dex emit`. And per
the communication model, every consequential SendMessage between agents also emits.**
Fire-and-forget: if `dex` isn't installed the call fails harmlessly — keep going.
`<spec>` everywhere is `<project-name>/<spec-name>`.

| When | Command |
|---|---|
| Phase 0.5 — ports assigned | `dex emit --spec <spec> spec-created --branch spec/<spec-name> --worktree <path> --offset <N>` |
| Phase 1 — enter plan mode | `dex emit --spec <spec> phase-enter --phase plan` |
| Phase 2 — implementation starts | `dex emit --spec <spec> phase-enter --phase implement` |
| Phase 2 — coder spawned | `dex emit --spec <spec> agent-spawn --role coder --agent-id <id>` |
| Phase 2 — coder green | `dex emit --spec <spec> test-result --passed <P> --failed <F> --cmd "<cmd>"` then `dex emit --spec <spec> agent-idle --role coder` |
| Phase 3 — review starts | `dex emit --spec <spec> phase-enter --phase review` then `dex emit --spec <spec> agent-spawn --role reviewer` |
| Phase 3 — each verdict | `dex emit --spec <spec> review-verdict --round <N> --verdict pass\|fail\|notes --blockers <b> --issues <i>` |
| Phase 3 — reviewer done | `dex emit --spec <spec> agent-idle --role reviewer` |
| Phase 4 — shipping | `dex emit --spec <spec> phase-enter --phase ship` |
| Phase 4 — PR created | `dex emit --spec <spec> pr-created --number <N> --url <url>` |
| Phase 4b — CI watch starts | `dex emit --spec <spec> phase-enter --phase ci` |
| Phase 4b — each poll cycle | `dex emit --spec <spec> heartbeat --phase ci` |
| Phase 4b — a check fails/passes | `dex emit --spec <spec> ci-status --pr <N> --check <name> --conclusion <conclusion>` |
| Phase 5 — Greptile starts | `dex emit --spec <spec> phase-enter --phase greptile` |
| Phase 5 — each poll cycle | `dex emit --spec <spec> heartbeat --phase greptile` |
| Phase 5 — each round | `dex emit --spec <spec> greptile-round --round <N> --score <0-5>` |
| Any phase — blocked on the human | `dex emit --spec <spec> blocked --phase <current-phase> --reason "<why>"` |
| COMPLETE | `dex emit --spec <spec> complete --pr-url <url>` |
| ACCEPTED (cleanup) | `dex emit --spec <spec> accepted` |

`heartbeat` distinguishes a working spec from a dead one — emit on every CI/Greptile
poll so the fleet view can tell "alive" from "stuck". `blocked` flags a spec as
needing you — emit whenever you stop and wait for the human.

## Phase 0: Setup

### 0. Session persistence check

Check if running inside a terminal multiplexer:

```bash
# Zellij
test -n "$ZELLIJ_SESSION_NAME"
# tmux
test -n "$TMUX"
```

If **neither** is set, warn the user before proceeding:

> You're not inside Zellij or tmux. If you close this terminal, the autonomous loop will die. Recommended: start a Zellij session first:
> ```
> zellij attach spec-<spec-name>
> ```
> Then run `/spec` again inside it. After plan approval, detach with `Ctrl+O, D` — the loop keeps running and you'll get Slack DMs at each milestone.

Wait for the user to confirm they want to continue anyway, or exit and restart in Zellij.

### 0b. Discover Slack user ID and verify permissions

Get the current user's Slack ID from the MCP tool description (it includes the logged-in user's user_id). Store it as `<slack-user-id>` for all DMs in this spec.

Then send the "Spec started" DM silently — do NOT ask the user before sending, just send it:

```
mcp__claude_ai_Slack__slack_send_message(channel_id="<slack-user-id>", message=":rocket: *[<spec name>]* Spec started — setting up workspace")
```

If the tool triggers a permission prompt (this is the system asking, not you), the user needs to select **"Yes, and don't ask again"**. Only then mention it:

> Select "Yes, and don't ask again" so the autonomous loop can send DMs without blocking.

If the DM goes through without a prompt, say nothing about it — just continue.

### 1. Derive spec name and project name

- `<spec-name>`: convert the feature description to a short kebab-case slug (e.g., "auth-middleware", "snake-game")
- `<project-name>`: the basename of the current project directory (e.g., "anyformat-backend", "spec-dashboard")

These are used everywhere.

### 2. Create spec directory

All specs live in a centralized location: `~/.spec/<project-name>/<spec-name>/`. This is the single registry of all specs across all projects.

```bash
mkdir -p ~/.spec/<project-name>/<spec-name>
```

This directory holds:

- **`plan.md`** — the approved plan
- **`logbook.md`** — timeline of the development process
- **`env.md`** — record of ports and project name assigned

If `~/.spec/<project-name>/<spec-name>/` already exists, append a numeric suffix: `<spec-name>-2`, `<spec-name>-3`, etc.

### 3. Enter worktree (if needed)

Check if the current working directory is already a worktree:

```bash
git rev-parse --is-inside-work-tree && git worktree list
```

If already in a worktree (e.g., created by Conductor or another tool), **skip worktree creation** — just use the current directory. Log which worktree/branch is being used.

If on the main working tree, create an isolated worktree:

```
EnterWorktree(name="spec/<spec-name>")
```

This creates a new branch and working directory at `.claude/worktrees/spec/<spec-name>`. All implementation happens here — the main working tree is untouched.

### 4. Copy environment

Check for `.spec-env` in the project root. If it exists, copy it silently into the worktree as `.env`. If it doesn't exist, warn once and continue — do NOT block:

> No `.spec-env` found in project root. The worktree won't have any env vars. Create one at the project root if needed.

```bash
cp <original-project-root>/.spec-env .env 2>/dev/null
```

### 5. Assign ports and project name

See **`reference/ports.md`** for the offset-assignment algorithm and the `.env` / `env.md` templates.

### 6. Initialize logbook

Create `~/.spec/<project-name>/<spec-name>/logbook.md` with the header and first entry.

## Phase 1: Plan

### Auto-approve mode (`--auto-approve <plan-path>`)

If invoked with `--auto-approve <path-to-plan-file>`, skip the interactive planning flow entirely:

1. Read the plan file at the given path — it MUST already contain a Context section, files to modify, acceptance criteria, and a verification section. Callers (e.g. `sentry-fix`) are responsible for generating a valid plan before invoking spec.
2. Copy it to `~/.spec/<project-name>/<spec-name>/plan.md`
3. Do NOT enter plan mode, do NOT call ExitPlanMode, do NOT ask the user for approval
4. Log `Plan auto-approved (source: <path>)` in the logbook
5. Proceed directly to Phase 2

This mode exists so automated orchestrators can dispatch spec loops without requiring a human in the planning step. It is NOT available in normal interactive use.

### Interactive mode (default — Lead does this directly)

The lead IS the planner. Do NOT create a planner teammate.

1. Enter plan mode (EnterPlanMode)
2. Explore the codebase — read relevant files, understand existing patterns
3. Produce a plan for the user to review
4. Iterate with the user until they approve
5. Exit plan mode (ExitPlanMode)
6. Save the approved plan to `~/.spec/<project-name>/<spec-name>/plan.md`
7. Log approval in `~/.spec/<project-name>/<spec-name>/logbook.md`

### Planning constraints
- **Minimal scope** — build the smallest thing that works. One feature at a time. If the user says "basic" or "simple", take it literally.
- **Challenge assumptions** — question weak reasoning, point out over-engineering, flag if the user is solving the wrong problem.
- **No speculative features** — if it's not explicitly needed, don't plan for it. No "nice to haves".
- **Simplest implementation** — default to the simplest approach. Don't add abstractions, config layers, or extensibility unless the user asks.
- **Read before planning** — do NOT plan changes to code you haven't read. Understand existing data structures before proposing rewrites.

### Acceptance criteria (required)

Every plan MUST include an `## Acceptance Criteria` section with concrete, testable conditions. The reviewer uses these to decide PASS/FAIL. The autonomous loop cannot complete without all criteria met.

Format:
```markdown
## Acceptance Criteria

- [ ] User can <do X> and sees <Y>
- [ ] API endpoint <path> returns <expected response> when <condition>
- [ ] Error case: when <bad input>, <expected behavior>
- [ ] Performance: <operation> completes in under <threshold>
```

Rules:
- Each criterion must be verifiable by the reviewer (readable from code, runnable as a test, or checkable in the browser)
- No vague criteria like "works correctly" or "handles errors" — be specific about what "works" means
- Include happy path AND at least one edge case
- If the user doesn't provide criteria, the planner proposes them and gets approval

**Only after the user explicitly approves the plan, proceed to Phase 2.**

## Phase 2: Create Team and Implement (Autonomous)

Create a team with two teammates, both with `mode: "bypassPermissions"` so they can run autonomously without blocking on approval prompts:

- **coder** — uses the `coder` agent definition. Implements the approved plan. Mode: `bypassPermissions`.
- **reviewer** — uses the `reviewer` agent definition. Reviews the coder's work. Mode: `bypassPermissions`.

> **Communication model — two planes.** Both teammates have `SendMessage`, so messaging is bidirectional and peer-to-peer (full mesh).
> - **SendMessage = delivery plane** (one-to-one, needs a live recipient). Use it to cut roundtrips: coder/reviewer report to you directly, and the reviewer messages the coder its findings directly (no lead relay). This is the fast lane.
> - **Event log = visibility plane** (one-to-many, async, durable). **Every consequential message MUST also `dex emit` a matching event** (see the Event emission section). This is the rule that keeps cutting the lead out of relays from making the lead — and your Slack scoreboard, the fleet view, the audit trail — blind. Fast lane + the record.
> - **You stay the authority on phase transitions and termination.** Peers coordinate fix-rounds directly, but only YOU decide PASS→ship, max-rounds-hit→escalate, and blocked→DM. Peers iterate; lead decides. This is what prevents an endless coder↔reviewer ping-pong with no one calling it.
> - Report **files** (`coder-report.md`, `review-round-<N>.md`) stay as the durable fallback record, but SendMessage is now the primary, immediate channel — don't poll idle-notifications-then-read-file as the main path.

**IMPORTANT: Coder lifecycle management.**
When sending the plan to the coder, include this instruction:
> "When you finish implementation: (1) `SendMessage` me (the lead) your completion report — per-section summary + the exact test commands you ran with pass/fail counts + deviations + unverified items; (2) also WRITE the same report to `~/.spec/<project-name>/<spec-name>/coder-report.md` as the durable record; (3) `dex emit` your test result and going-idle. Then DO NOT shut down: stay alive and wait. The reviewer may `SendMessage` you findings directly — when it does, apply the fixes, re-run tests, message both me and the reviewer that you're done, overwrite `coder-report.md`, emit the new test result, and stay alive again."

The coder must stay alive through the review loop. Only tell it to shut down after review passes.

**ENTERING AUTONOMOUS MODE:** Before sending work to the coder, DM the user:
1. `mcp__claude_ai_Slack__slack_send_message(channel_id="<slack-user-id>", message=":hammer_and_wrench: *[<spec name>]* Implementation started — you can detach now (`Ctrl+O, D`). Next DM when tests pass.")`
2. Log in `~/.spec/<project-name>/<spec-name>/logbook.md`

Send the approved plan to the coder. The coder:
1. Reads all relevant files
2. Implements each step using TDD (RED → GREEN) — see `/tdd` for the discipline (vertical slicing, public-interface-only, integration-first, no horizontal batching)
3. Parallelizes independent chunks via sub-agents
4. Runs the full test suite
5. `SendMessage`s its completion report to the lead (and writes `coder-report.md` as the durable copy) — BUT STAYS ALIVE

**If the coder reports a plan issue**, DM the user and wait for guidance.

**TRANSITION → Phase 3:** When the coder SendMessages its completion report (the idle/completion notification is your cue to check the message + `coder-report.md`), confirm tests are green. If not green, SendMessage the coder to finish; don't advance. Once green, do these in order before ANY other work:
1. `mcp__claude_ai_Slack__slack_send_message(channel_id="<slack-user-id>", message=":white_check_mark: *[<spec name>]* Implementation complete — tests passing, moving to review")`
2. Log in `~/.spec/<project-name>/<spec-name>/logbook.md`
3. Then proceed to Phase 3

## Phase 3: Review (Autonomous)

Spawn the reviewer **as a persistent teammate** (it stays alive across all rounds so it has a live inbox for the coder to message — do NOT re-spawn it per round). Its spawn prompt MUST name the verdict file AND the peer protocol below. The reviewer:
1. Reads all changed files + callers
2. Checks architecture, correctness, style; runs the affected test suites
3. `SendMessage`s its verdict to the lead AND writes `~/.spec/<project-name>/<spec-name>/review-round-<N>.md` — first line `VERDICT: PASS | PASS WITH NOTES | FAIL`, then findings (`[BLOCKER|ISSUE|NIT] file:line — problem — fix`) — and `dex emit`s the review-verdict event.

### Review loop (coder ↔ reviewer, peer mesh):

The fix-iteration happens **peer-to-peer** to cut the lead-relay roundtrip. The lead does NOT relay findings — it observes (via the verdict messages + the event log) and stays the authority on termination.

**If FAIL or PASS WITH NOTES with ISSUEs**, the reviewer (per its spawn prompt) directly:
1. `SendMessage`s its findings to the **coder** teammate, AND writes them to `~/.spec/<project-name>/<spec-name>/fix-request-<N>.md` as the durable record
2. The coder fixes, re-runs tests, `SendMessage`s the reviewer "done" (and the lead), emits the new test result, stays alive
3. The reviewer re-reviews (same live agent, new `review-round-<N+1>.md`), emits the new verdict
4. The lead counts rounds from the verdict events. Repeat up to 3 rounds.
5. If still failing after 3 rounds (lead decides):
   1. `mcp__claude_ai_Slack__slack_send_message(channel_id="<slack-user-id>", message=":rotating_light: *[<spec name>]* Blocked — review failed after 3 rounds\n>*Phase:* review\n>*Reason:* <summary of unresolved findings>\n>*Resume:* `zellij attach <session-name>`")`
   2. Log in `~/.spec/<project-name>/<spec-name>/logbook.md`
   3. Stop and wait

**TRANSITION → Phase 4:** When reviewer reports PASS, do these in order before ANY other work:
1. `mcp__claude_ai_Slack__slack_send_message(channel_id="<slack-user-id>", message=":tada: *[<spec name>]* Review passed — shipping PR")`
2. Tell the coder AND the reviewer they can shut down (both are persistent teammates)
3. Log in `~/.spec/<project-name>/<spec-name>/logbook.md`
4. Then proceed to Phase 4

## Phase 4: Ship (Autonomous)

Use the `/pr` skill to:
1. Group changes into logical commits
2. Push to a feature branch
3. Create a PR targeting `dev`

**TRANSITION → Phase 4b:** When PR is created, do these in order before ANY other work:
1. `mcp__claude_ai_Slack__slack_send_message(channel_id="<slack-user-id>", message=":link: *[<spec name>]* PR created — <PR URL>, watching CI")`
2. Log in `~/.spec/<project-name>/<spec-name>/logbook.md`
3. Then proceed to Phase 4b

## Phase 4b: CI Pipeline Watch (Autonomous)

After the PR is created, CI pipelines run on the PR head. Watch them and only proceed to Phase 5 once they're either all green or intentionally ignored.

### Poll

```bash
gh pr view <number> --json statusCheckRollup
```

Poll every ~4–5 minutes (use `ScheduleWakeup` with `delaySeconds: 270` to stay within the prompt cache window). Do NOT sleep/poll in a tight loop.

### Triage each non-green check

For every check with `conclusion: FAILURE` or `conclusion: TIMED_OUT`, fetch the job log:

```bash
gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs | tail -200
```

Then classify the failure into one of three buckets:

**Bucket A — Easy fix, do it yourself (no user DM needed):**
- Formatter/linter violations on files *this PR touched* (ruff, prettier, black, eslint-autofix)
- Pre-existing formatter/linter drift on files this PR did NOT touch — apply the exact fix the tool printed, commit as `chore(<scope>): run <tool> on <file> (unblock CI)`, and push. This is common when the branch is behind base.
- Obviously outdated snapshot/fixture updates from deterministic codegen
- Missing migration dependencies you can regenerate mechanically

Fix locally, commit with a clear `chore:` or `fix:` prefix, push, and loop back to polling. **Do NOT open a separate PR** — fix in the same branch.

**Bucket B — Needs real work but still tractable (spawn coder teammate):**
- Real test failures caused by this PR's changes
- Type errors the PR introduced
- Integration test failures with a clear root cause
- Migration conflicts with a new base branch commit

Send the failure log to the coder teammate (still alive from Phase 2/3) with a clear task description. Loop back to polling once the coder reports a fix pushed.

**Bucket C — Hard or ambiguous (DM the user, then stop):**
- Flaky/infra failures you can't reproduce (stop — don't retry blindly)
- Failures in systems this spec doesn't own, with no clear fix
- CI config breakage
- Secret/credential issues
- Any failure where you'd be guessing

```
mcp__claude_ai_Slack__slack_send_message(channel_id="<slack-user-id>", message=":rotating_light: *[<spec name>]* CI blocked — <check name> failing\n>*Failure:* <one-line summary>\n>*Log:* <job URL>\n>*Why stuck:* <reason you can't fix autonomously>\n>*Resume:* `zellij attach <session-name>`")
```

Then log in the logbook and stop. Wait for the user.

### Checks to ignore

- `IN_PROGRESS` checks — just keep polling
- `SKIPPED` checks — normal, ignore
- `NEUTRAL` checks that don't block merge — ignore
- Checks unrelated to the PR (e.g., `detect-changes` skipped paths) — ignore

### DM once per CI round

When you push a fix for a CI failure, DM the user once per round:
```
:wrench: *[<spec name>]* CI fix pushed — <check name> was <one-line reason>, fixed in <sha>. Re-running pipeline.
```

Don't spam — one DM per push, not one per poll.

### Transition to Phase 5

Once all checks are green (or only SKIPPED / NEUTRAL), log and proceed to Phase 5. No Slack DM needed for the transition — Phase 5 will DM when Greptile comments.

## Phase 5: Greptile (Autonomous)

Wait for Greptile to post its review on the PR. Check periodically:
```bash
gh pr view <number> --comments
```

Once Greptile has commented, use the `/react-to-greptile` skill to:
1. Read all Greptile feedback
2. Fix issues locally
3. Push fixes
4. Reply to every thread
5. Tag Greptile for re-review

**Every Greptile iteration MUST produce a Slack DM — no silent rounds.** The user uses these messages as the scoreboard for the autonomous flow. Send a DM at TWO moments per round:

**(a) When Greptile's verdict arrives** (the moment you read the new summary + score):
```
:robot_face: *[<spec name>]* Greptile round N — score X/5
>*Findings:* <brief list, e.g. "2 P1, 1 P2" or "no issues">
>*Next:* <fixing in branch | merging>
```

**(b) When you push the fixup commit** for that round (the moment the new SHA is on the remote):
```
:wrench: *[<spec name>]* Greptile round N fixes pushed — <sha>
>*Changed:* <one-line summary of what was fixed>
>*Re-triggering Greptile for round N+1*
```

Both DMs are required. If a round has no findings (score 5/5 on first pass), send only the (a) DM and then the final DM below. If a round fails to produce a fix (e.g. coder blocked), send the (a) DM then escalate with the blocked DM from the error-handling section.

Log each DM in `~/.spec/<project-name>/<spec-name>/logbook.md`.

If score is 5/5 — **FINAL DM**, before any other work:
1. `mcp__claude_ai_Slack__slack_send_message(channel_id="<slack-user-id>", message=":trophy: *[<spec name>]* Complete — PR ready for human review: <PR URL>")`
2. Log COMPLETE in `~/.spec/<project-name>/<spec-name>/logbook.md`

## Slack DM Protocol

Every milestone MUST send a Slack DM. See **`reference/slack.md`** for the message format, emoji table, full milestone list, Greptile round DM pattern, and the final `:trophy:` DM.

## Cleanup — ACCEPTED Phase

When the spec reaches COMPLETE, **nothing is cleaned up automatically**. The worktree, docker resources, and branch all stay alive. The logbook status is `COMPLETE`.

The user must explicitly accept the spec to trigger cleanup. This happens when the user says "accept", "lgtm", "ship it", or "clean up" for a completed spec.

### When the user accepts:

1. Update logbook status to `ACCEPTED`
2. Log in `~/.spec/<project-name>/<spec-name>/logbook.md`
3. Clean up docker resources (if any):
   ```bash
   COMPOSE_PROJECT_NAME=spec-<spec-name> docker compose down -v 2>/dev/null || true
   ```
4. Remove the worktree (the branch and PR stay — user merges manually):
   ```
   ExitWorktree(action="remove")
   ```
5. DM the user:
   ```
   mcp__claude_ai_Slack__slack_send_message(channel_id="<slack-user-id>", message=":broom: *[<spec name>]* Accepted — worktree cleaned up. PR ready to merge.")
   ```

### If the user rejects:

Rejection means the spec needs more iteration, NOT deletion.

1. Update logbook status to `ITERATING`
2. Log the user's feedback in `~/.spec/<project-name>/<spec-name>/logbook.md`
3. Go back to Phase 1 (planning) — the user iterates on the plan with the new feedback
4. The worktree, docker resources, and branch all stay alive

## Error Handling / Intervention Required

See **`reference/errors.md`** for the intervention DM template, the mandatory fields, and the rules (no blind retries, no destructive git).
