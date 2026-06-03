# specdex — Design System

The visual identity for **specdex**: a desktop app (Tauri, vanilla HTML/CSS/JS) that
visualizes autonomous AI coding runs as a living **fleet**. Each running spec is a
**minion** — a small card that quietly carries a lifecycle phase, a health state, and
0–2 working agents.

The system is **minimal + tactile**: calm, generous negative space and a restrained
palette, but the surfaces are **physical** — drams hardware, not flat web chrome.
Cards are raised and lift toward you; toggles and buttons press; status reads as
**glowing LEDs** and recessed sockets. It is a *single-window tool*, not a marketing
site — every token is chosen for legibility at a glance and for hours of ambient
watching without fatigue.

> **Note (2026-06):** this system started near-flat (hairline rules, `box-shadow:
> none`). It was deliberately re-skinned toward drams' *physical* component language —
> soft layered depth, pressed wells, LED indicators. The sections below describe the
> tactile system as shipped; `drams-components.html` is the live component reference.

---

## 1. Inspiration → concrete cues

Derived from **https://drams.framer.website/** (a Dieter-Rams-themed Framer site,
"less, but better"). The live page was inspected directly; the cues that drove this
system:

| Cue from Drams | What it became here |
|---|---|
| Near-black ink `rgb(38,38,38)` on off-white paper `#f7f7f7` / `#f4f4f4` | `--ink` / `--paper` — the whole light theme is built on this exact pair, not pure black-on-white (softer, calmer). |
| **Inter** at weights **400 / 450 / 500**, 700 only rarely | Our type scale tops out at **560**; body is 400/450. No bold-heavy headings. |
| Two accents: a calm blue `rgb(0,153,255)` and a warm orange `#FF611A`, used *sparingly* | Blue `#0a84ff` is the single interactive accent. The Drams orange inspired our **`needs-you`** ember `#e8601a` — the one warm hue, reserved for "a human is needed." |
| Soft, rounded **hardware** corners — knobs, buttons, switch tracks | Cards use a soft `12px`; circles (`50%`) for the LED life-dot, agent pips, rail sockets, and the sidebar push-button. |
| **Physical depth** — the components are raised plastic with soft drop shadows, pressed wells, dished faces | The `--lift` / `--lift-hover` / `--press` / `--well` token set. Cards are raised and lift on hover; toggles/buttons press in; rail sockets are recessed. Shadows are *soft and warm*, never harsh. |
| The **LED indicator dot** — a small lit pip with a colored halo | The life-dot and active agent pips are radial-sheen LEDs with a `--hue` glow; the current rail node is a lit LED; the sidebar button's LED lights ember when expanded. |
| Muted neutral grays `#6e6e6e`, `#cfcfcf` | `--ink-muted` / `--ink-faint` for secondary + tertiary text. |
| Airy, unobtrusive, "shouldn't be taken too seriously" but never cartoonish | The minion is a *creature you read*, not an emoji. Personality comes from the breathing LED and the tactile surfaces, not faces. |

---

## 2. Color

Defined as CSS custom properties on `:root` (light) and `:root[data-theme="dark"]`.
Two surfaces deep, hairline rules, one interactive accent, five health hues.

### Light (default)

```css
:root {
  /* surfaces */
  --paper:      #f4f3f0;   /* app background — warm off-white, from Drams paper */
  --surface:    #fbfaf8;   /* minion card */
  --surface-2:  #ffffff;   /* raised / hover */
  --rule:       #e4e2dc;   /* hairline borders, dividers */
  --rule-soft:  #eeece7;

  /* ink */
  --ink:        #232220;   /* primary text — Drams' near-black, warmed */
  --ink-muted:  #6e6a62;   /* secondary */
  --ink-faint:  #a8a399;   /* tertiary / placeholder */

  /* single interactive accent (Drams blue) */
  --accent:     #0a84ff;
  --accent-fg:  #ffffff;
  --accent-soft:#dcebfd;

  /* health hues — calm, desaturated; each = dot color + soft wash */
  --alive:      #3f9d6b;  --alive-soft:   #e4f1ea;   /* working — green, breathing */
  --idle:       #8b8780;  --idle-soft:    #ecebe7;   /* waiting — neutral, resting */
  --stale:      #b08a3e;  --stale-soft:   #f4ecd9;   /* no heartbeat — muted amber */
  --needs:      #e8601a;  --needs-soft:   #fbe7da;   /* blocked on human — the ember */
  --done:       #5a86c4;  --done-soft:    #e6edf7;   /* complete — restful slate-blue */

  --shadow:     0 1px 2px rgba(40,38,34,.04), 0 2px 8px rgba(40,38,34,.04);
  --shadow-lift:0 2px 6px rgba(40,38,34,.06), 0 8px 24px rgba(40,38,34,.07);
}
```

### Dark

```css
:root[data-theme="dark"] {
  --paper:      #16150f;
  --surface:    #1e1c16;
  --surface-2:  #262319;
  --rule:       #2e2b22;
  --rule-soft:  #262319;

  --ink:        #ece8dd;
  --ink-muted:  #9c968a;
  --ink-faint:  #6b665b;

  --accent:     #5aa6ff;
  --accent-fg:  #11151c;
  --accent-soft:#1e3552;

  --alive:      #5fc08a;  --alive-soft:  #18271e;
  --idle:       #9a958a;  --idle-soft:   #242219;
  --stale:      #d3a85a;  --stale-soft:  #2c2516;
  --needs:      #ff7a3d;  --needs-soft:  #2e1c12;
  --done:       #7ba6e0;  --done-soft:   #1a2230;

  --shadow:     0 1px 2px rgba(0,0,0,.30), 0 2px 8px rgba(0,0,0,.28);
  --shadow-lift:0 2px 6px rgba(0,0,0,.34), 0 10px 28px rgba(0,0,0,.40);
}
```

**Rules**

- **One interactive accent** (`--accent`, blue). It marks the *only* thing you can act
  on per screen. Never use it for status.
- **`needs-you` owns the only warm hue.** The ember `--needs` is the single point of
  warmth in the whole palette — that is *why* it draws the eye without an alarm. No red,
  no flashing, no badge-count anxiety.
- Health is communicated by the **LED life-dot color + a thin tinted top edge**, never
  by recoloring the whole card. Calm > loud.

---

## 3. Typography

System stack only — no Google Fonts, no CDN. Inter if locally installed (the Drams
face), otherwise the platform UI font.

```css
--font-sans: "Inter", "Inter Variable", -apple-system, BlinkMacSystemFont,
             "Segoe UI", system-ui, sans-serif;
--font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
```

**Scale** — small, tight, restrained. Headings never exceed weight **560**
(Drams uses 500; 700 is rare). Letter-spacing tightens as size grows.

| Token | size / line-height | weight | use |
|---|---|---|---|
| `--t-display` | 22px / 1.2  | 560 | fleet title |
| `--t-h2`      | 15px / 1.3  | 540 | section labels |
| `--t-name`    | 14px / 1.3  | 520 | minion name |
| `--t-body`    | 13px / 1.45 | 440 | reasons, meta |
| `--t-meta`    | 12px / 1.4  | 450 | phase, counts |
| `--t-micro`   | 10.5px / 1.3| 540 | uppercase eyebrow labels, tracking `.08em` |
| `--t-mono`    | 12px / 1.4  | 450 | PR #, project path |

- Numerals use `font-variant-numeric: tabular-nums` everywhere they update live
  (review round, PR, scores) so the layout never jitters.
- Uppercase micro-labels carry the only letter-spacing; everything else is tight or neutral.

---

## 4. Spacing, radius, shadow

A **4px base grid**. Density is "airy desktop" — comfortable, not cramped, not webby.

```css
--s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
--s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px;

--r-card: 12px;   /* minion card, spec-doc well — soft hardware corners */
--r-pill: 999px;  /* LED dots, rail sockets, toggle track, chips */
--r-chip: 6px;    /* small tags, the attach button */
```

**Depth tokens** — the tactile system. Soft, warm, layered; never harsh:

```css
--lift:       /* a raised surface (cards, buttons, timeline nodes) */
--lift-1:     /* a lighter raise (knobs, chips, the sidebar button) */
--lift-hover: /* lifts toward you on hover */
--press:      /* an inset/recessed press (toggle track, pressed button, spec-doc well) */
--well:       /* the flat color of an empty recessed socket (rail sockets/grooves) */
```

- **Depth carries the hardware feel.** Raised cards/buttons use `--lift`; recessed
  wells and pressed states use `--press`; the rail's empty sockets use `--well`.
- Cards **lift on hover** (`--lift-hover` + `translateY(-2px)`); buttons press on
  `:active`. Motion + depth = the tactile response.
- Card min-width ~280px, grid auto-fills; gutters `--s-4`. The fleet breathes.

---

## 5. Motion

Calm, slow, optional. Motion conveys *life*, never urgency.

```css
--ease: cubic-bezier(.4, .0, .2, 1);     /* standard */
--ease-soft: cubic-bezier(.25,.1,.25,1); /* settles, no overshoot */
--dur-fast: 140ms; --dur: 240ms; --dur-slow: 420ms;
```

Principles:

1. **The life-dot breathes.** The single source of "this is alive" is a slow opacity +
   scale pulse on the health dot (~2.6s for `alive`, slower/none for calmer states).
   Nothing else animates on idle.
2. **Enter/leave is a settle, not a pop.** New minions fade + rise `6px` over `--dur-slow`;
   leaving ones fade + drop. No bounce — the playfulness lives in the *tactile* response,
   not in springy entrances.
2b. **Tactile response.** Cards lift toward you on hover (`--lift-hover` + `-2px`);
   buttons and the sidebar push-button press in on `:active`; the toggle knob slides with
   a slight spring. Depth changing under the cursor is the "feel" of the hardware.
3. **State changes cross-fade** the dot color and left-edge tint over `--dur`. A phase
   advance slides the rail node, it doesn't jump.
4. **Respect `prefers-reduced-motion`** — all looping/transform animation is disabled;
   states still read via color and the static dot.
5. No spinners. Activity is shown by the breathing dot + active agent pips, not a throbber.

---

## 6. Minion anatomy

A minion is a **card you read like a face without a face**. Reading order, top-left to
bottom-right:

```
┌─[health edge]──────────────────────────────┐
│  ● parse-cache                       PR 4012 │   life-dot + name        · pr (mono, right)
│  anyformat-backend                           │   project path (mono, muted)
│                                              │
│  ◐ ◐ ◑ ◑ ◐ ◐ ◑ ●━━━━━━━━━━━━━━━━━○ ○        │   phase rail (8 nodes; filled=done, ring=current)
│  VERIFY                                       │   current phase label (micro, uppercase)
│                                              │
│  [coder ●] [reviewer ○]      round 2 · ★ 4   │   agent pips (left) · review meta (right)
│  ⚑ infra flake                               │   blocked reason — only when needs-you
└──────────────────────────────────────────────┘
```

### Parts

1. **Health edge** — a 3px tinted left border + a faint full-card wash in the matching
   `--*-soft`. This is the ambient "how is it doing" read from across the room. Calm
   tint, never a fill.

2. **Life-dot** — a glowing **LED** (`--r-pill`, 9px): a radial sheen over the `--hue`
   plus a colored halo (`box-shadow`). Its **color = health**, and its **motion =
   liveness**:
   - `alive` — `--alive` green, **breathing** (2.6s pulse).
   - `idle` — `--idle` neutral gray, **steady**, slightly dimmed. At rest.
   - `stale` — `--stale` amber, **steady + a faint dashed ring** (heartbeat missed).
   - `needs-you` — `--needs` ember, **slow attention pulse** (3.4s, gentle), plus the
     ember edge. Draws the eye by *warmth + the only colored edge*, not by speed.
   - `done` — `--done` slate-blue, **solid, no motion**, fully at rest.

3. **Name** (`--t-name`) — the spec name, the identity. Project path sits beneath in
   mono `--ink-muted` (the `project` field).

4. **Phase rail** — a hardware progress strip of 8 sockets for `setup · plan · build ·
   review · ship · verify · complete · accepted`. *Before* current = quietly-lit
   `--ink-faint` pips; *current* = a **glowing LED in the health hue**; *after* =
   recessed empty `--well` sockets. Sunk grooves connect them. Reads like progress
   without a percentage bar's pressure. The current phase name shows below as a label.

5. **Agent pips** — up to two: `coder`, `reviewer`. A filled pip = `active:true`, a
   hollow ring = present but `active:false`. Active pips inherit the breathing of the
   life-dot (subtler). Label in `--t-meta`. Absent role = absent pip (no placeholder).

6. **Review meta** (right of agents) — `round N` and a small `★ score` (1–5) when
   `review_round` / `review_score` are present. Tabular nums so they don't jitter on
   update. Hidden when zero/absent.

7. **PR badge** — top-right, mono `PR 4012`, `--accent` text only when present, links out.
   Absent → nothing (no empty slot).

8. **Blocked reason** — a single line with a small `⚑` flag glyph, shown **only** for
   `needs-you`, in `--needs` ink. This is the call to action; it's the lowest line so the
   eye lands on it last but unmistakably.

### Health → treatment summary

| health | dot color | dot motion | card edge / wash | extra |
|---|---|---|---|---|
| `alive` | green | breathe 2.6s | green hairline + faint wash | active agent pips breathe |
| `idle` | gray | none (dimmed) | neutral, minimal | — |
| `stale` | amber | none + dashed ring | amber, faint | "no heartbeat" read |
| `needs-you` | ember | slow pulse 3.4s | ember edge + warm wash | blocked-reason line + flag |
| `done` | slate-blue | none, solid | slate, soft | rail fully filled, restful |

### Phase → treatment

Phase only drives the **rail** (which node is ringed) and the **micro-label**. It does
*not* change card color — health owns color, phase owns position. Late phases
(`ship`/`verify`/`complete`/`accepted`) naturally show a fuller rail, giving a sense of a
spec "maturing" left-to-right without any extra styling.

---

## 7. Files

- `DESIGN.md` — this document.
- `index.html` — the prototype shell (topbar, soft theme toggle, sidebar, fleet grid).
- `style.css` — all tokens (incl. the `--lift`/`--press`/`--well` depth set) + every
  component, light & dark.
- `app.js` — renders ~6 hardcoded sample minions (every health state, several phases)
  from the `FleetRow` shape, and wires the 2-position `light ↔ dark` soft toggle.
- `drams-components.html` — self-contained reference gallery of the tactile components
  (soft toggle, push buttons, slider, rotary dial, segmented switch) in the palette.

Open `index.html` or `drams-components.html` directly in a browser — no build step, no
framework, no CDN.
