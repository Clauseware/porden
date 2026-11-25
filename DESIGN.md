---
name: Porden
description: Pass with confidence. Dark-only handoff tooling for developers.
colors:
  oxide-lavender: "#c5a1c9"
  oxide-lavender-hover: "#d6bcd9"
  on-lavender: "#0c0c0e"
  near-black: "#0c0c0e"
  charcoal: "#1a1a1f"
  charcoal-raised: "#24242b"
  off-white: "#f5f5f5"
  muted-ash: "#a3a3ad"
  hairline: "#2e2e36"
  field-edge: "#6a6a76"
  danger-coral: "#ff9b94"
  danger-wash: "#2a1517"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "58px"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-2px"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-1px"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.4px"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  eyebrow:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "2px"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontSize: "12px"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.oxide-lavender}"
    textColor: "{colors.on-lavender}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
  button-primary-hover:
    backgroundColor: "{colors.oxide-lavender-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.oxide-lavender}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
  button-secondary-hover:
    backgroundColor: "{colors.charcoal-raised}"
  input:
    backgroundColor: "{colors.near-black}"
    textColor: "{colors.off-white}"
    rounded: "{rounded.md}"
    padding: "11px 12px"
  input-readonly:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ash}"
  panel:
    backgroundColor: "{colors.charcoal}"
    rounded: "{rounded.lg}"
    padding: "28px"
  badge:
    backgroundColor: "{colors.charcoal}"
    textColor: "{colors.oxide-lavender}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  notice:
    backgroundColor: "{colors.charcoal-raised}"
    textColor: "{colors.off-white}"
    padding: "14px"
  notice-danger:
    backgroundColor: "{colors.danger-wash}"
    textColor: "{colors.danger-coral}"
---

# Design System: Porden

**Status:** Implemented in `apps/brand.css` and each app's `globals.css`. Tokens below match the code on 24 November 2026.
**Companion:** [brand.md](./brand.md)

## Overview

**Creative North Star: "The Quiet Relay"**

Porden moves a task from one system to another and keeps a record of who approved what. The interface is a calm, near-black field where one colour, Oxide Lavender, marks every action that moves the task forward. Surfaces stay quiet so the handoff itself reads clearly: who holds the task, what was shared, what was approved, what is still unknown.

The system is dark-only. Depth comes from tonal steps (near black, charcoal, raised charcoal) and thin hairlines, never from shadows or gradients. Density is that of a developer tool: readable 16px body, compact labels, generous panel padding, no decoration that does not explain state.

Brand lives in precise details: the lavender symbol beside the wordmark, lavender focus rings, the lavender dot on each timeline event. Everything else is off-white text on charcoal.

**Key Characteristics:**
- Dark-only (`color-scheme: dark`); no light theme.
- One accent hue, Oxide Lavender, on every action that matters and on focus.
- Flat tonal layering; no shadows.
- Inter / system sans for everything except IDs, digests and code.
- State always written in words; colour only supports it.

## Colors

One cool lavender accent on a neutral near-black ramp.

### Primary
- **Oxide Lavender** (`oxide-lavender`): primary buttons, links, eyebrows, badges, timeline dots, focus rings, the logo symbol. Contrast 8.67:1 on near black, 7.69:1 on charcoal.
- **Oxide Lavender Hover** (`oxide-lavender-hover`): hover state of lavender buttons and links.
- **On Lavender** (`on-lavender`): text and icons placed on lavender fills (8.67:1).

### Neutral
- **Near Black** (`near-black`): page background and input fill.
- **Charcoal** (`charcoal`): panels, cards, tables, badges.
- **Charcoal Raised** (`charcoal-raised`): notices and secondary-button hover.
- **Off White** (`off-white`): headings and body text (17.93:1 on near black).
- **Muted Ash** (`muted-ash`): hints, metadata, footers, secondary labels (6.93:1 on charcoal).
- **Hairline** (`hairline`): dividers, panel and table borders. Decorative only; never the sole boundary of a control.
- **Field Edge** (`field-edge`): input and secondary-button borders. Meets 3:1 against near black (3.66:1) and charcoal (3.25:1).

### Semantic
- **Danger Coral** on **Danger Wash** (`danger-coral`, `danger-wash`): error and refusal notices (8.51:1). Always paired with written text.

### Named Rules
**The Lavender Means Go Rule.** Lavender fills only elements that move a task forward or show where the keyboard is. Never use it for decoration, large backgrounds or illustration fills inside the app.

**The No Hard-Coded Hex Rule.** Components use `var(--…)` tokens from `apps/brand.css`. A new colour is added there first, with its contrast checked.

## Typography

**Display Font:** Inter (with `ui-sans-serif, system-ui, sans-serif`)
**Body Font:** Inter (same stack)
**Label/Mono Font:** `ui-monospace, SFMono-Regular, monospace` for IDs, digests, step numbers and code

**Character:** One neutral sans carries headings and body. Headings are bold with tight negative tracking; the wordmark is heavier still (750, -1.2px).

### Hierarchy
- **Display** (700, `clamp(36px, 5vw, 58px)`, 1.08): one hero heading per page on the merchant and courier sites.
- **Headline** (700, 36-40px, 1.25): page titles in the dashboard and task consumer.
- **Title** (600, 21px, 1.3): panel and section headings.
- **Body** (400, 16px, 1.6): all running text; keep lines under about 70ch.
- **Label** (600, 14px): form labels and buttons.
- **Eyebrow** (700, 12px, 2px tracking, uppercase): the one-line kicker above a display heading, in lavender.
- **Mono** (12px): identifiers, digests, step numbers.

### Named Rules
**The Words Not Weights Rule.** Hierarchy comes from size and position. Do not add a second typeface or ultra-light weights.

## Layout

Single centred column: 1160px max on merchant and courier, 1200px on the dashboard, 1000px for the task consumer. Side padding 32px, 18px below 720px. Merchant and courier pages use a two-column workspace (1.15fr / 1fr, 24px gap) that collapses to one column below 720px. The dashboard comparison grid uses `repeat(auto-fit, minmax(min(100%, 360px), 1fr))`.

Spacing steps are 8, 12, 16, 24 and 32px. Panels pad 28px (22px on narrow screens). Sections are separated by hairline rules, not by background changes.

## Elevation & Depth

No shadows. Depth is tonal: near black page, charcoal panel, raised charcoal for content inside a panel that needs separation (notices). A review panel is marked by a lavender border, not by lift.

**The Flat Relay Rule.** Nothing floats. If an element needs more attention, it gets a lavender edge or fill, not a shadow.

## Shapes

Gently rounded. Controls (buttons, inputs) use 8px corners, panels and cards 12px, step chips 4px, badges are full pills. Borders are 1px; accents that mark state (notices, errors, evidence quotes) use a 3-4px left rule. The logo symbol is the only custom geometry.

## Components

### Buttons
- **Shape:** gently rounded (8px).
- **Primary:** lavender fill, near-black label, 600 weight, 12px 18px padding. Used for every action that advances a handoff (sign in, prepare, approve, accept).
- **Hover / Focus:** hover lightens to Oxide Lavender Hover over 150ms; focus shows a 2px lavender outline with 3px offset.
- **Secondary:** transparent with a Field Edge border and lavender label; hover fills Charcoal Raised. Used for cancel, refuse, sign out and other actions that do not advance the task.
- **Disabled:** 50-55% opacity with `not-allowed` cursor.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Charcoal.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px Hairline; a review panel uses a lavender border.
- **Internal Padding:** 28px, 22px on narrow screens.

### Inputs / Fields
- **Style:** Near Black fill, Field Edge border, 8px corners, off-white text.
- **Focus:** 2px lavender outline, 3px offset.
- **Read-only:** transparent fill, dashed Field Edge border, Muted Ash text, plus a hint that says why it cannot change.
- **Invalid:** `aria-invalid` and `aria-describedby` point at the error notice; focus returns to the field.
- **Disabled:** the whole fieldset drops to 70% opacity.

### Navigation
- **Topbar:** lavender symbol, off-white lowercase **porden** wordmark (28px, 750), then a muted context label (`/ merchant`). A lavender pill badge names the organisation on the right; hidden below 720px.
- **Links:** lavender, underline offset 4px, hover to Oxide Lavender Hover.

### Notices
- **Information:** Charcoal Raised fill with a 3-4px lavender left rule.
- **Error / refusal:** Danger Wash fill, Danger Coral text and left rule.
- **Neutral status** (for example, nothing to check yet): plain text in a persistent `role="status"` region, never styled as an error.

### Outcome Panel
- **Accepted:** default panel with a "Receipt verified" badge, the receipt IDs and a lavender "Start a new case" button.
- **Unknown / courier declined:** lavender border; the only action is "Check courier receipt". The form stays locked.
- **Refused / cancelled:** Danger Coral border and heading; the form stays usable.
- Focus moves to the outcome heading when the panel appears.

### Event Timeline (signature component)
A vertical hairline with a 7px lavender dot per event, 14px text, newest state last. It is the visual centre of every handoff screen.

## Do's and Don'ts

### Do:
- **Do** use tokens from `apps/brand.css` and the `PordenSymbol` component from `apps/logo.tsx`.
- **Do** give every action that moves a task forward the lavender primary style.
- **Do** write state in words (Accepted, Refused, Outcome unknown) next to any colour.
- **Do** show a visible lavender focus ring on every interactive element.
- **Do** keep motion to 120-180ms state transitions and honour `prefers-reduced-motion`.

### Don't:
- **Don't** add a light theme or light surfaces.
- **Don't** use shadows, gradients, glass or glow.
- **Don't** hard-code hex values in components or inline styles (the global error pages are the only exception, because they render without the stylesheet).
- **Don't** use lavender for decoration, illustration fills or large backgrounds inside the app.
- **Don't** imply success from optimistic UI state; show unknown outcomes as unknown.

## Information Architecture

### Public website (proposed)
1. **Home:** clear product statement and a small, understandable handoff demonstration.
2. **How it works:** task ownership, transferred context, outcomes and visibility.
3. **Docs:** quickstart, API reference, SDK reference, integration guides.
4. **Examples:** realistic workflows with agent and human participants.
5. **GitHub / project links.**

Header: symbol and wordmark, Product, Docs, GitHub, and a lavender "Get started" button.

### Application (proposed)
1. **Overview:** recent handoffs and operational status.
2. **Handoffs:** searchable list with owner, state, creation time and last activity.
3. **Handoff detail:** context, timeline, decisions, evidence and current responsibility.
4. **Integrations:** API credentials and connection settings where supported.
5. **Settings:** organisation and developer preferences.

Only build screens backed by actual product behaviour. This IA is for planning, not a claim that these features exist.

## Core Application Screens

### Handoffs list
- Search by task identifier or text; filter by state and owner when the backend supports it.
- Columns: task, current owner, state, updated, origin. Each row opens the detail view.
- The empty state explains how the first handoff is created.

### Handoff detail
- **Header:** title, state, current owner, identifiers, primary contextual action.
- **Main:** chronological event timeline with explicit actor and timestamp.
- **Context panel:** data needed to continue work, with source and version.
- **Decisions / evidence:** structured reasons or references attached to an event.
- **Technical view:** request/response payloads and trace identifiers, with copy actions.

Show unavailable data explicitly. Never imply a handoff succeeded from optimistic UI state.

### Integration / developer settings
- Clear environment labels; credentials masked by default.
- Destructive actions require confirmation.

## Accessibility and Usability

- Target WCAG 2.2 AA. Text pairings in this file are measured; recheck any new pairing.
- Visible keyboard focus on every interactive element.
- Semantic labels and accessible names for controls.
- Never communicate task state with colour alone.
- Provide loading, empty, error, refusal, cancellation and unknown-outcome states.
- Show understandable local time, with precise timestamps available.

## Content and Microcopy

Prefer: "Handoff requested", "Waiting for acceptance", "Context attached", "View event history", "Check the transfer before trying again". Avoid vague AI language and unexplained system terms. Use the same names in UI, docs, SDK and backend contracts.

## Frontend Engineering Handoff

**Frontend:** Next.js apps in `apps/merchant-web`, `apps/courier-web`, `apps/dashboard-web`, plus the shared `apps/task-consumer.tsx`.
**Shared design files:** `apps/brand.css` (tokens and base), `apps/logo.tsx` (symbol), `app/icon.svg` per app (favicon).
**Backend:** separate Bun + Hono API with PostgreSQL; SDK/API-first.

- Define data contracts with the backend before binding UI states.
- Distinguish requested, accepted, completed, refused and unknown outcomes according to backend semantics.
- Avoid invented statuses, metrics or placeholder evidence.
- Keep API errors actionable and keep request IDs for debugging.

## Open Decisions

- Official logo vectors. `apps/logo.tsx` is a hand-drawn approximation of the selected symbol.
- Display typeface: the brand sheet shows a geometric sans; the code still uses Inter / system.
- Merchant and courier `globals.css` are identical copies; extract shared component styles if they keep matching.
- Final API state terminology and scope of the first public dashboard release.
