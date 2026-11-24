# Porden — Brand Guidelines

**Status:** Brand identity sheet adopted (Oxide Lavender, dark-only). Final logo vectors and trademark clearance remain open.
**Version:** 0.2 · 24 November 2026

## 1. Brand foundation

**Name:** Porden
**Pronunciation:** POR-den
**Category:** Developer infrastructure for reliable AI-agent and human handoffs.

### Product description
Porden helps developers transfer tasks between independent systems while preserving context, approvals, responsibilities, and evidence. It is an API/SDK-first product that integrates with existing systems, with a web interface for visibility and management.

### Positioning
Infrastructure for accountable handoffs in AI-powered workflows.

### Working elevator pitch
> Porden helps AI agents hand off tasks while keeping the context, decisions, and progress intact. It makes it easier for developers to build reliable workflows across agents and humans.

### Brand attributes
- **Reliable:** behaves the same way every time and says so when it does not know.
- **Continuous:** context and responsibility carry across every handoff.
- **Verifiable:** approvals and evidence are records, not claims.
- **Open:** plain contracts, readable SDKs, nothing hidden behind jargon.
- **Thoughtful:** carefully considered details and precise interactions.

### Naming and verbal identity
- Product name: **Porden**, with an initial capital in prose.
- Lowercase **porden** is used for the wordmark, package naming, and command-line references.
- Prefer concrete words: task, owner, context, evidence, decision, history, handoff.
- Avoid inflated claims such as “autonomous intelligence revolution” or “zero-error agents.”
- Tagline: **Pass with confidence.** The full stop is part of the lockup. It must not imply a security or reliability guarantee.

## 2. Color system

### Approved palette: Oxide Lavender (dark-only)

| Token | Hex | Role |
|---|---|---|
| Oxide Lavender | `#C5A1C9` | Primary: logo symbol, primary actions, links, focus |
| Near Black | `#0C0C0E` | Background; text on lavender |
| Charcoal | `#1A1A1F` | Surfaces: panels, cards, tables |
| Off White | `#F5F5F5` | Text |

The interface has no light theme. Implementation tokens, including hover, muted text, borders and danger tones, live in `apps/brand.css` and are documented with measured contrast in [DESIGN.md](./DESIGN.md).

### Color usage
- Default to Near Black backgrounds, Charcoal surfaces and Off White text.
- Use Oxide Lavender on every action that moves a task forward, and on focus.
- Never use lavender as decoration, a large background inside the app, or a gradient.
- Semantic states use written text first; colour only supports it.
- The full lavender field is reserved for the reverse logo lockup and brand moments outside the app (covers, stickers, app icon).

## 3. Logo identity

### Symbol
A geometric “P” built from two offset blocks: a bowl that passes over a stem. It reads as one party handing something to the next. The selected form is “4. Final” on the brand identity sheet; earlier explorations (Base P, Bridge, Connect) are retired.

### Lockups
1. **Primary:** lavender symbol, off-white lowercase **porden** wordmark, optional tagline below. On Near Black.
2. **Reverse:** near-black symbol and wordmark on an Oxide Lavender field.
3. **Wordmark only:** off-white **porden**, for docs headers and tight spaces.
4. **Symbol only:** favicon, avatars, app icon.
5. **Single colour:** all white on dark; all black on white or light material.

### Small sizes
- App icon (512 × 512): near-black symbol on a rounded lavender tile.
- Favicon (32 × 32): same tile, symbol simplified if needed.
- 16 × 16: symbol alone, no tile.

### Construction rules
- The mark works without gradients, shadows, or animation.
- Keep clear space at least equal to the height of the wordmark's lowercase `o` on all sides.
- Avoid literal robot heads, sparkles, circuit brains, and generic infinity loops.

**Important:** `apps/logo.tsx` and `app/icon.svg` contain a hand-drawn approximation of the selected symbol. Replace them with official vectors once they exist. Trademark clearance is not done.

## 4. Typography

### Type stack
- **Wordmark and display:** the brand sheet uses a bold geometric sans. The final typeface and its licence are not chosen; the code uses Inter until then.
- **Interface:** Inter, falling back to system sans-serif.
- **Code and technical metadata:** system monospace (`ui-monospace`, SFMono-Regular).

### Hierarchy principles
- Strong headings with compact line heights and slight negative tracking.
- Readable body text: 16 px in the apps, 16–18 px on marketing pages.
- Avoid ultra-light weights and decorative display fonts.
- Use monospaced type for IDs, code, timestamps, and structured evidence, not entire paragraphs.

## 5. Imagery and graphic language

### Preferred
- Clear flow diagrams showing task movement and ownership.
- Technical-manual-inspired linework and restrained annotations on dark grounds.
- Real interface captures and code examples.
- Geometric forms drawn from the symbol's two blocks.

### Avoid
- Glowing AI orbs, robot mascots, and stock neural-network illustrations.
- Gratuitous 3D chrome, glass panels, and ambient neon gradients.
- Fake dashboards with meaningless data.
- Generic sparkle motifs used as shorthand for AI.

## 6. Voice and copy

Porden speaks plainly. Lead with what developers can do and what happens to a task when ownership changes.

**Example homepage heading:**
“Hand off work. Keep the context.”

**Supporting copy:**
“Porden helps agents and people pass tasks along with the information needed to continue.”

**CTA ideas:** “Get started”, “Read the docs”, “See a handoff”.

Avoid claiming guaranteed delivery, perfect traceability, or complete accountability until the implementation supports those promises.

## 7. Brand applications

### Website
Near Black page, primary lockup in the nav, links Product · Docs · GitHub, and a lavender “Get started” button. Interactive handoff examples and real documentation excerpts.

### Documentation
Dark, navigation-first layout: wordmark at the top of the sidebar, active page marked with a lavender tint, high-legibility body text, copyable snippets, restrained syntax highlighting.

### SDK / CLI
Simple, predictable naming and human-readable errors. `@porden/sdk` is a **proposed** package name; package scope availability is unverified.

### Social / GitHub
Symbol-only logo on Oxide Lavender or Near Black. Keep cover imagery typographic and product-led.

### Merchandise
Stickers use the reverse lockup (black symbol and wordmark on lavender) with a white die-cut border.

## 8. Brand governance and open decisions

**Decided:** Porden name as working product brand; Oxide Lavender dark-only palette; symbol “4. Final”; tagline “Pass with confidence.”; developer-tool aesthetic.

**To validate:** official logo vectors; display typeface and licence; trademark and domain clearance; package/organization availability.

Keep [DESIGN.md](./DESIGN.md) as the implementation companion to these brand guidelines. Update both when visual decisions change.
