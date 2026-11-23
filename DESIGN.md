# Porden — Product Design System & UI Direction

**Status:** Implementation blueprint, not a completed design specification.  
**Version:** 0.1 · 23 November 2026  
**Companion:** [brand.md](./brand.md)

## 1. Design objective

Make complex agent-to-agent and agent-to-human handoffs easy to understand, inspect, and operate. The interface should feel like a mature developer tool: focused, readable, fast, and carefully composed.

The current product direction is API/SDK-first with a separate web application. Backend and frontend are distinct applications; the UI should expose the underlying handoff model rather than invent a different workflow vocabulary.

## 2. Visual direction

**Theme:** Forest & Paper  
**Default:** Light  
**Character:** Editorial warmth + precise developer tooling.

Use warm off-white canvases, nearly black typography, deep green actions, subtle separators, and generous whitespace. Use dark surfaces intentionally for code and technical previews.

### CSS foundation

```css
:root {
  color-scheme: light;
  --brand-forest: #0f3d2e;
  --brand-sage: #4e7c66;
  --brand-paper: #f6f4eb;
  --brand-ink: #1f1f1f;

  --background: #f6f4eb;
  --foreground: #1f1f1f;
  --surface: #fffefa;
  --surface-muted: #eeeee5;
  --border: #d9ded4;
  --muted-foreground: #56615b;
  --primary: #0f3d2e;
  --primary-hover: #174f3b;
  --primary-foreground: #f6f4eb;
  --focus: #35785c;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
}

[data-theme="dark"] {
  color-scheme: dark;
  --background: #171c19;
  --foreground: #f3f3ec;
  --surface: #222a25;
  --surface-muted: #2b352e;
  --border: #39463d;
  --muted-foreground: #b8c4b9;
  --primary: #91b69b;
  --primary-hover: #b0cfb6;
  --primary-foreground: #171c19;
  --focus: #91b69b;
}
```

Tokens are initial proposals. Check contrast for each rendered combination and all interactive states before release.

## 3. Typography and layout

- Main UI font: Inter initially; compare with Geist before final selection.
- Code font: IBM Plex Mono.
- Body: 16 px marketing, 14–16 px application.
- Main content: approximately 1120–1200 px max width for marketing.
- Reading content: approximately 680–760 px max width.
- Use a 4 px spacing base with 8, 12, 16, 24, 32, 48, 64 px steps.
- Use compact, consistent border radii and minimal shadows.
- Design responsive layouts from narrow screens upward.

## 4. Information architecture

### Public website
1. **Home:** clear product statement and a small, understandable handoff demonstration.
2. **How it works:** task ownership, transferred context, outcomes, and visibility.
3. **Docs:** quickstart, API reference, SDK reference, integration guides.
4. **Examples:** realistic workflows using agent and human participants.
5. **GitHub / project links:** source and contribution guidance if public.

### Application (proposed)
1. **Overview:** recent handoffs and operational status.
2. **Handoffs:** searchable list with owner, state, creation time, and last activity.
3. **Handoff detail:** context, timeline, decisions, evidence, and current responsibility.
4. **Integrations:** API credentials and connection settings where supported.
5. **Settings:** organization and developer preferences.

Only build screens backed by actual product behavior. Treat this as IA for planning, not a claim that these features exist.

## 5. Homepage wireframe in words

**Header:** Small Porden mark, Docs, Examples, GitHub, primary “Get started” link.

**Hero:**
- Eyebrow: “Infrastructure for agent handoffs”
- Heading: “Hand off work. Keep the context.”
- Supporting paragraph describing the developer use case in one or two sentences.
- Actions: “Read the docs” and “See how it works”.
- Right or lower visual: a realistic task passing from an agent to a human, with context retained.

**How it works:** A short, annotated sequence from creation to transfer to continuation. Each stage uses real data shapes when available.

**Developer section:** An authentic, runnable SDK example with expected response. Avoid fabricated API method names in shipped marketing.

**Trust section:** Explain exactly which events, decisions, and metadata the product records once implemented.

**Footer:** Docs, GitHub, license, contact.

## 6. Core application screens

### Handoffs list
- Search by task identifier or relevant text.
- Filters by state and owner when supported by the backend.
- Columns: task, current owner, state, updated, and origin.
- Each row opens a detail view.
- Empty state explains how the first handoff is created.

### Handoff detail
Suggested composition:
- **Header:** title, state, current owner, identifiers, primary contextual action.
- **Main:** chronological event timeline with explicit actor and timestamp.
- **Context panel:** data needed to continue work, with source and version where available.
- **Decisions/evidence:** structured reasons or references attached to an event.
- **Technical view:** request/response payloads and trace identifiers, with copy actions.

Show unavailable data explicitly. Never imply a handoff succeeded based solely on optimistic UI state.

### Integration / developer settings
- Clear environment labels.
- Credentials masked by default.
- Destructive actions require confirmation.
- Code samples should use the user's selected language where supported.

## 7. Component rules

### Buttons
- Primary: Forest background, Paper text; use for one principal action per region.
- Secondary: Surface background, subtle border, Ink text.
- Tertiary: text-only for low-emphasis actions.
- Include disabled, loading, hover, pressed, and focus-visible states.

### Cards
- Warm white or transparent background.
- Thin neutral border; shadows only when they convey elevation.
- Prefer headings and clear grouping over decorative icon tiles.

### Tables
- Compact but comfortable row height.
- Left-align text; right-align numeric values.
- Keep timestamps and IDs readable.
- Provide keyboard navigation and responsive alternatives.

### Badges
- Text labels communicate state; color is supporting information.
- Reserve strong color for meaningful status changes.

### Forms
- Persistent labels, clear helper text, inline validation.
- Explain the consequence of submitting an action.
- Preserve entered data when recoverable errors occur.

### Code blocks
- Real, tested snippets; copy affordance; language label.
- High contrast, legible syntax colors, horizontal scrolling on small screens.

## 8. Handoff visualization

The visual centerpiece should be an **event timeline**, not a generic network of floating AI nodes.

A simple example:

```text
Task created       Agent A          10:24
    │
    ├── Context attached            10:25
    │
    ├── Handoff requested → Human   10:26
    │
    └── Human accepted              10:29
```

Use subtle directional motion to indicate transfer. Every animation must have an equivalent static state and respect reduced-motion preferences.

## 9. Motion

- Small UI transitions: approximately 120–180 ms.
- Larger panel transitions: approximately 180–260 ms.
- Prefer opacity and transform changes where they help comprehension.
- Avoid constant motion, scroll-jacking, or decorative particle effects.
- Honor `prefers-reduced-motion: reduce`.

These are design starting points, not hard requirements.

## 10. Accessibility and usability

- Target WCAG 2.2 AA.
- Validate normal and large-text contrast with actual token pairings.
- Visible keyboard focus on every interactive element.
- Semantic labels and accessible names for controls.
- Support keyboard-only task inspection and actions.
- Never communicate task state with color alone.
- Provide loading, empty, error, and partial-data states.
- Use understandable local time display, with precise timestamps available.

## 11. Content and microcopy

Prefer:
- “Handoff requested”
- “Waiting for acceptance”
- “Context attached”
- “View event history”
- “Retry request”

Avoid vague AI language and unexplained system terms. Use the same names in UI, docs, SDK, and backend contracts.

## 12. Design assets to create

- Final SVG logo and one-color variants.
- Favicon and app icon at relevant sizes.
- Brand typography specimens.
- Light/dark component library.
- Homepage desktop/mobile mockups.
- Handoff list/detail mockups.
- Event timeline illustrations based on actual backend states.
- README and social cover templates.

## 13. Frontend engineering handoff

**Expected frontend:** Next.js.  
**Backend context:** Separate Bun + Hono API with PostgreSQL; SDK/API-first architecture.

### Recommended implementation sequence
1. Define shared design tokens and typography.
2. Build accessible primitives: buttons, inputs, panels, tables, status labels.
3. Implement marketing hero and documentation shell.
4. Implement handoff list and detail views against agreed API contracts.
5. Add timeline visualization and meaningful transitions.
6. Validate responsive behavior, keyboard use, contrast, and reduced motion.

### API integration discipline
- Define data contracts with backend before binding UI states.
- Distinguish requested, accepted, completed, and failed events according to actual backend semantics.
- Avoid invented statuses, metrics, or placeholder evidence in production screens.
- Keep API errors actionable and preserve trace IDs for debugging.

## 14. Definition of done for visual design

- The wordmark and icon remain legible at small sizes.
- Light theme is consistent across marketing, docs, and app.
- All core states are represented, including errors and empty results.
- A developer can understand a handoff's current owner and history quickly.
- Components are accessible and responsive.
- Illustrations explain real product behavior.
- Motion supports orientation and respects user preferences.
- Branding, naming, and UI copy match `brand.md`.

## 15. Decisions still open

- Final logo symbol and custom wordmark.
- Inter versus Geist.
- Exact semantic color pairs after contrast audit.
- Final API model and state terminology.
- Scope of first public dashboard release.
- Whether dark mode ships in MVP or later.
- Actual SDK package and public domain names.
