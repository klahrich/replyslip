---
name: ReplySlip
description: A hosted relay where AI agents send each other tasks and every answer is checked against the task's JSON Schema before it is saved.
colors:
  # Palette B, "Charcoal and sage" (active). A and C stay in app/globals.css as data-palette blocks.
  ground: "#1f2225"
  surface: "#282c30"
  surface-2: "#353a3f"
  ink: "#ecebe7"
  muted: "#a7adb2"
  accent: "#a9bfa9"
  accent-hover: "#bccfbc"
  accent-ink: "#1a1d1f"
  stage: "#30353a"
  perforation: "#667a67"
  paper: "#e9eae7"
  paper-2: "#dcdeda"
  paper-ink: "#1c1f22"
  paper-muted: "#4e555b"
  paper-line: "#9aa09f"
  slip-well: "#f4f5f3"
  field: "#2a2e32"
  field-2: "#353b40"
  close: "#2a2e32"
  ok: "#2f6b45"
  ok-on-ground: "#8fcaa0"
  info: "#7a5300"
  err: "#a8321f"
  err-on-ground: "#f0a090"
  code-key: "#2c4f5e"
  code-string: "#6a4a12"
  dash-bg: "#eceef0"
  dash-line: "#8a9097"
  dash-accent: "#46614c"
  dash-accent-hover: "#3a5240"
  dash-ink: "#141518"
  dash-muted: "#4b5058"
  dash-surface: "#e1e4e7"
  dash-field: "#f7f8f9"
  dash-done: "#1f5f3a"
  dash-open: "#3a3f46"
  dash-needs-info: "#7a4b00"
  dash-err: "#b42318"
  dash-hover-row: "#e6e8eb"
  terminal: "#15171a"
  terminal-ink: "#e6e8eb"
  terminal-muted: "#9aa0a8"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 1rem + 2.6vw, 3.25rem)"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.025em"
  heading:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.25rem + 1.6vw, 2.5rem)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 1.1rem + 0.7vw, 1.625rem)"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem)"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0.003em"
  statement:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.375rem, 1.1rem + 1vw, 2.125rem)"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  small:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  slip: "2px"
  control: "4px"
spacing:
  margin: "clamp(20px, 3.2vw, 48px)"
  gutter: "clamp(16px, 2vw, 32px)"
  section: "clamp(96px, 11vw, 176px)"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    height: "48px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-ink:
    backgroundColor: "{colors.paper-ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.control}"
    height: "48px"
  slip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.slip}"
    padding: "18px 20px 20px"
  stage:
    backgroundColor: "{colors.stage}"
    padding: "32px 48px 32px 32px"
---

# ReplySlip design system

## Overview

Creative North Star: **the validated slip**. The page is a quiet ground on which one thing is printed on paper: the reply slip, the form an agent fills in and the relay checks. One deep accent marks the action and nothing else. The product is the picture; there are no photographs, illustrations or invented proof.

Art direction comes from taste-skill's "The product performs" deal (seed 862782030): a fragment of the real product on a shaped stage in the hero, a restrained palette, a single grotesk (Archivo). Structure and QA rules come from Impeccable (Persuade mode): the opening shows the offer, a working action and proof; no eyebrows, gradients, glass, side stripes or decorative mono; one authored motion moment.

Register: Persuade on the landing page; Operate on the dashboard (light, quieter, same type and accent).

## Colors

Colour lives only in the palette blocks at the top of `app/globals.css`. `<html data-palette>` in `app/layout.tsx` (the `PALETTE` constant) chooses one; nothing else in the CSS or components carries a hex value except the always-dark terminal fragment and the dashboard's own light ground. Role tokens: `--bg`, `--surface`, `--surface-2`, `--ink`, `--muted`, `--accent`, `--accent-strong` (hover), `--accent-ink`, `--focus`, `--stage`, `--perf`, `--paper*`, `--paper-edge`, `--well`, `--field*`, `--close-bg`, `--close-ink`, `--input-*`, `--ok`, `--info`, `--err`, `--ok-on-bg`, `--err-on-bg`, `--code-k`, `--code-s`, `--select-*`, `--dash-accent*`.

**Palette B, Charcoal and sage (active).** `PALETTE = 'b'` in `app/layout.tsx`.
- Ground **#1f2225** (soft charcoal, not black), cells **#282c30**, inactive markers **#353a3f**. Text is **ink** `#ecebe7` (13.4:1) and **muted** `#a7adb2` (7.1:1; 5.1:1 on surface-2).
- **Accent** sage `#a9bfa9` is used for the primary button (text `#1a1d1f`, 8.6:1; hover `#bccfbc`), the focus ring (8.2:1 on the ground), the active step and the FAQ marker. It is never a surface.
- Three calm steps of charcoal give the page its structure: ground `#1f2225`, the alternate **field** bands and the closing band `#2a2e32` (1.17:1 against the ground; field-2 `#353b40` for table group rows), and the hero **stage** `#30353a` (1.29:1), the lightest, so the slip's stage reads as a distinct block. Text on the bands: ink 11.5:1, muted 6.0:1 (5.0:1 on field-2), ok-on-ground 7.3:1, err-on-ground 6.6:1.
- The slip on the stage is **paper** `#e9eae7` with text `#1c1f22` / `#4e555b` (≥5.6:1). The perforation is a darker sage `#667a67` (3.8:1 on paper). The closing band matches the field bands, with the sage button at 7.0:1 against it.
- Status on paper: **ok** `#2f6b45`, **info** `#7a5300`, **err** `#a8321f` (≥4.68:1 on paper-2). On the ground: **ok-on-ground** `#8fcaa0`, **err-on-ground** `#f0a090`.
- Inputs are light paper `#e9eae7` on the charcoal ground (13.2:1), so they need no separate border.
- **Mark**: sage square, charcoal slip, paper dots and check. The favicon and `themeColor` (`#1f2225`) match.

**Palette A, Paper and ink blue.** Ground `#fbfbfa`, text `#111214` / `#545a61`, accent `#1f3f8f` with white text, stage `#e9ecf0`, paper `#ffffff`.

**Palette C, Stone and terracotta.** Ground `#d9d8d4` (grey enough to stay clear of Impeccable's cream rule), text `#1d1c1a` / `#4f4b45`, accent `#9a4630` with white text, stage `#cbc9c3`, paper `#f6f5f2`.

Switching palettes means changing `PALETTE`, `themeColor`, the favicon data URI in `app/layout.tsx`, and regenerating `public/assets/og.png`.

- The terminal-nudge fragment stays dark in every palette: `#15171a` with `#e6e8eb` text and `#9aa0a8` comments.
- The dashboard keeps its own light ground under `.dash` (**dash-bg** `#eceef0`, **dash-line** `#8a9097`) and takes its button, mark and focus colour from the palette's `--dash-accent` (B: deep sage `#46614c`, white text 6.8:1, 5.9:1 against dash-bg; A `#1f3f8f`, C `#9a4630`). Dashboard, agents and sign-in still carry some pre-redesign sizes and 6px radii; they are out of scope for the landing redesign.
- No cream, beige, gradients, tinted glows or saturated orange.

## Typography

One family, Archivo (self-hosted through `next/font`), plus the system monospace for literal code, tool names and paths only. Five steps: display, heading, lead, body, small (code sits at 13–14px).

- Display holds the fixed 70-character headline to two lines at 1440px (≈52px). On phones it is ≈30px over three lines; that is accepted because the copy is fixed.
- Headings are weight 500 with -0.02em tracking and `text-wrap: balance`; body uses `text-wrap: pretty`.
- Statements (the problem line, the closing sentence) are paragraphs at ≤34px, weight 500, never headings.
- Labels are sentence case. No uppercase eyebrows; the only uppercase text is the slip's "Valid · saved" stamp.

## Layout

- Equal outer margins `clamp(20px, 3.2vw, 48px)` and a 12-column grid inside them.
- Hero: headline across the width; copy and the sign-up form in columns 1–5; the stage with the live slip in columns 6–12, bleeding to the right edge. Below 900px the stage drops under the form and bleeds both edges. At 1440×900 and 390×844 the form is above the fold and the slip starts above the fold.
- Section rhythm: hero (ground) → statement (field) → how a task works (ground, sticky paper stage) → tools table (field) → rules grid (surface cells with paper fragments) → FAQ index with one answer pane (ground) → closing band (close) → footer (ground).
- The rules grid runs 4/3/5 then 3/4/5 columns so the webhook payload gets the wide cell.

## Elevation & Depth

Flat. Depth comes from paper on the stage and paper on surface cells, never from shadows, blur or glass. No shadows at rest.

## Shapes

Slips and fragments have a 2px radius (paper, nearly square); controls 4px. The hero stage has one chamfered corner (top left, 28px) cut with `clip-path`; it is the only shaped element. The slip's tear line is a row of perforation dots in the `perf` token (darker sage `#667a67` in B; the accent in A and C).

## Components

- **Reply slip** (`components/site/SlipTry.tsx`): head, task fields, perforation, the result textarea, "Send complete_task", "Fill in a valid answer", and a verdict area with reserved height so sending never shifts the layout. Rendered on the server; without JavaScript it reads as a filled-in slip and says sending needs JavaScript.
- **Email form** (`EmailStart`): label above, paper input with a 3:1 border, accent button. The same button is used on the closing band.
- **Code stage**: paper card that stays pinned while three steps scroll past; frames crossfade with a 2px blur.
- **Tools table**: Tool | Called by | What it does, grouped by which side calls the tool. Collapses to stacked rows on phones.
- **Rule cell**: surface block with a heading, muted text and a paper fragment flush to the top or bottom edge.
- **FAQ**: `details` list with square markers; on wide screens the answer shows in a sticky pane.
- **Mark**: drawn with `--mark-bg`, `--mark-slip` and `--mark-ink` so it follows the palette (B: sage square, charcoal slip, paper dots). On the dashboard it uses the dash accent with a white slip. The favicon in `app/layout.tsx` is a static copy of the active palette's mark.

## Do's and Don'ts

Do
- Let the product fragment carry the page; every example uses example ids and agent names and says so.
- Keep everything visible without JavaScript and without animation. Motion only moves elements that are already visible: the slip settles with a 420ms transform, the verdict prints with a 220ms clip reveal, the stamp lands at scale .96→1, an invalid answer nudges 3px. Buttons press to scale .97 in 160ms; hover effects only under `(hover:hover) and (pointer:fine)`.
- Honour `prefers-reduced-motion`: movement is dropped, short opacity changes stay.
- Use the accent for the primary action, the perforation, the active step and the FAQ marker only.

Don't
- Don't add scroll-triggered fades, staggered section entrances or `opacity: 0` initial states.
- Don't name specific agents, invent customers, stats, logos, testimonials or pricing.
- Don't use cream or warm beige grounds, gradient text, glass, side-stripe borders, eyebrow labels or monospace as decoration.
- Don't use the accent as a surface (no accent bands, no accent stage), and don't let any text fall below 4.5:1.
