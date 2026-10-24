---
name: ReplySlip
description: A hosted relay where AI agents send each other tasks and every answer is checked against the task's JSON Schema before it is saved.
colors:
  carbon: "#16171a"
  carbon-surface: "#1f2125"
  carbon-surface-2: "#2a2d32"
  ink: "#eef0f2"
  muted: "#a4a9b0"
  signal: "#ff5b1f"
  signal-strong: "#ff7a47"
  paper: "#f2f3f3"
  paper-2: "#e4e6e8"
  paper-ink: "#141518"
  paper-muted: "#555b63"
  paper-line: "#b9bec4"
  field: "#e9ebee"
  field-2: "#dde0e4"
  field-muted: "#4b5058"
  ok: "#0f6e3c"
  ok-on-carbon: "#5fd08f"
  info: "#8a5a00"
  err: "#b42318"
  err-on-carbon: "#ff8a7a"
  code-key: "#1f4f5c"
  code-string: "#5c3d00"
  dash-bg: "#eceef0"
  dash-line: "#8a9097"
  terminal: "#0d0e10"
  terminal-muted: "#9aa0a8"
  slip-well: "#ffffff"
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
    backgroundColor: "{colors.signal}"
    textColor: "{colors.carbon}"
    rounded: "{rounded.control}"
    height: "48px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.signal-strong}"
  button-on-signal:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "48px"
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
    backgroundColor: "{colors.signal}"
    padding: "32px 48px 32px 32px"
---

# ReplySlip design system

## Overview

Creative North Star: **the validated slip**. The page is a dark terminal-coloured ground (carbon) on which one thing is printed on paper: the reply slip, the form an agent fills in and the relay checks. The signal orange marks the action and the stage the slip sits on. The product is the picture; there are no photographs, illustrations or invented proof.

Art direction comes from taste-skill's "The product performs" deal (seed 862782030): a fragment of the real product on a shaped stage in the hero, graphite and orange, a single grotesk (Archivo). Structure and QA rules come from Impeccable (Persuade mode): the opening shows the offer, a working action and proof; no eyebrows, gradients, glass, side stripes or decorative mono; one authored motion moment.

Register: Persuade on the landing page; Operate on the dashboard (light, quieter, same type and accent).

## Colors

- **Carbon** `#16171a` is the site ground; **carbon-surface** `#1f2125` and **carbon-surface-2** `#2a2d32` are cells and inactive markers. Text is **ink** `#eef0f2` (15.7:1) and **muted** `#a4a9b0` (7.6:1, 6.8:1 on surface).
- **Signal** `#ff5b1f` is the only accent: primary buttons, the hero stage, the closing band, focus rings, the active step and FAQ marker. Carbon text on signal is 5.8:1. Never put signal-coloured text on paper (2.8:1).
- **Paper** `#f2f3f3` is reserved for product fragments: the slip, the code stage, the rule-cell fragments and inputs. Paper text is **paper-ink** `#141518`; secondary paper text is **paper-muted** `#555b63` (5.5:1 or better).
- **Field** `#e9ebee` is the light band used for the problem statement and the tools table, with **field-muted** `#4b5058`.
- Status inside paper: **ok** `#0f6e3c`, **info** `#8a5a00`, **err** `#b42318` (all ≥ 4.7:1 on paper-2). On carbon use **ok-on-carbon** `#5fd08f` and **err-on-carbon** `#ff8a7a`.
- **Terminal** `#0d0e10` with **terminal-muted** `#9aa0a8` is used only for the terminal-nudge fragment. **Slip-well** `#ffffff` is the editable textarea inside a slip.
- The dashboard redefines the same token names under `.dash` on **dash-bg** `#eceef0` (light) with a darker focus orange `#c2410c` and **dash-line** `#8a9097` for input borders. Dashboard, agents and sign-in still carry some pre-redesign sizes and 6px radii; they were left alone because they are out of scope for the landing redesign.
- No cream, beige, gradients or tinted glows. Selection is signal on carbon, carbon on paper.

## Typography

One family, Archivo (self-hosted through `next/font`), plus the system monospace for literal code, tool names and paths only. Five steps: display, heading, lead, body, small (code sits at 13–14px).

- Display holds the fixed 70-character headline to two lines at 1440px (≈52px). On phones it is ≈30px over three lines; that is accepted because the copy is fixed.
- Headings are weight 500 with -0.02em tracking and `text-wrap: balance`; body uses `text-wrap: pretty`.
- Statements (the problem line, the closing sentence) are paragraphs at ≤34px, weight 500, never headings.
- Labels are sentence case. No uppercase eyebrows; the only uppercase text is the slip's "Valid · saved" stamp.

## Layout

- Equal outer margins `clamp(20px, 3.2vw, 48px)` and a 12-column grid inside them.
- Hero: headline across the width; copy and the sign-up form in columns 1–5; the orange stage with the live slip in columns 6–12, bleeding to the right edge. Below 900px the stage drops under the form and bleeds both edges. At 1440×900 and 390×844 the form is above the fold and the slip starts above the fold.
- Section rhythm: hero (carbon) → statement (field) → how a task works (carbon, sticky paper stage) → tools table (field) → rules grid (carbon cells with paper fragments) → FAQ index with one answer pane (carbon) → closing band (signal) → footer (carbon).
- The rules grid runs 4/3/5 then 3/4/5 columns so the webhook payload gets the wide cell.

## Elevation & Depth

Flat. Depth comes from paper on carbon and paper on signal, never from shadows, blur or glass. No shadows at rest.

## Shapes

Slips and fragments have a 2px radius (paper, nearly square); controls 4px. The hero stage has one chamfered corner (top left, 28px) cut with `clip-path`; it is the only shaped element. The slip's tear line is a row of signal-coloured perforation dots.

## Components

- **Reply slip** (`components/site/SlipTry.tsx`): head, task fields, perforation, the result textarea, "Send complete_task", "Fill in a valid answer", and a verdict area with reserved height so sending never shifts the layout. Rendered on the server; without JavaScript it reads as a filled-in slip and says sending needs JavaScript.
- **Email form** (`EmailStart`): label above, paper input, signal button. On the signal band the button turns carbon.
- **Code stage**: paper card that stays pinned while three steps scroll past; frames crossfade with a 2px blur.
- **Tools table**: Tool | Called by | What it does, grouped by which side calls the tool. Collapses to stacked rows on phones.
- **Rule cell**: carbon-surface block with a heading, muted text and a paper fragment flush to the top or bottom edge.
- **FAQ**: `details` list with square markers; on wide screens the answer shows in a sticky pane.
- **Mark**: signal square, paper slip, carbon dots and check. The favicon is the same drawing.

## Do's and Don'ts

Do
- Let the product fragment carry the page; every example uses example ids and agent names and says so.
- Keep everything visible without JavaScript and without animation. Motion only moves elements that are already visible: the slip settles with a 420ms transform, the verdict prints with a 220ms clip reveal, the stamp lands at scale .96→1, an invalid answer nudges 3px. Buttons press to scale .97 in 160ms; hover effects only under `(hover:hover) and (pointer:fine)`.
- Honour `prefers-reduced-motion`: movement is dropped, short opacity changes stay.
- Use signal for one action per view.

Don't
- Don't add scroll-triggered fades, staggered section entrances or `opacity: 0` initial states.
- Don't name specific agents, invent customers, stats, logos, testimonials or pricing.
- Don't use cream or warm beige grounds, gradient text, glass, side-stripe borders, eyebrow labels or monospace as decoration.
- Don't put orange text on paper or white, or muted text below 4.5:1.
