# Porden — Brand Guidelines

**Status:** Brand direction approved; logo and tagline remain concepts.  
**Version:** 0.1 · 23 November 2026

## 1. Brand foundation

**Name:** Porden  
**Pronunciation:** POR-den  
**Category:** Developer infrastructure for reliable AI-agent and human handoffs.

### Product description
Porden helps developers hand off tasks between AI agents and people while preserving context, decisions, and progress. It is designed as an API/SDK-first product that can integrate with existing systems, with a web interface for visibility and management.

### Positioning
Infrastructure for accountable handoffs in AI-powered workflows.

### Working elevator pitch
> Porden helps AI agents hand off tasks while keeping the context, decisions, and progress intact. It makes it easier for developers to build reliable workflows across agents and humans.

### Brand attributes
- **Grounded:** clear, useful, and trustworthy.
- **Crafted:** carefully considered details and precise interactions.
- **Human:** readable language and approachable interfaces.
- **Quietly technical:** engineering credibility without sci-fi imagery.

### Naming and verbal identity
- Product name: **Porden**, with an initial capital in prose.
- Lowercase **porden** is appropriate for the wordmark, package naming, and command-line references.
- Prefer concrete words: task, owner, context, evidence, decision, history, handoff.
- Avoid inflated claims such as “autonomous intelligence revolution” or “zero-error agents.”
- Working tagline: **Pass with confidence.** This is provisional and must not imply a security or reliability guarantee.

## 2. Color system

### Approved foundation: Forest & Paper

| Token | Hex | Role |
|---|---|---|
| Forest | `#0F3D2E` | Primary brand, primary actions, dark brand surfaces |
| Sage | `#4E7C66` | Supporting accents, diagrams, secondary highlights |
| Paper | `#F6F4EB` | Primary warm page background |
| Ink | `#1F1F1F` | Main text, strong contrast, dark UI surfaces |

### Extended UI palette (proposed, subject to accessibility testing)

| Token | Hex | Use |
|---|---|---|
| Canvas | `#F6F4EB` | Page background |
| Surface | `#FFFEFA` | Cards, panels, popovers |
| Surface muted | `#EEEEE5` | Subtle grouping |
| Border | `#D9DED4` | Dividers and component outlines |
| Text primary | `#1F1F1F` | Body and headings |
| Text secondary | `#56615B` | Supporting labels |
| Forest hover | `#174F3B` | Hover on brand-colored surfaces |
| Forest pressed | `#0B3024` | Pressed interaction |
| Focus | `#35785C` | Focus indicator, with adequate contrast and offset |
| Inverse text | `#F6F4EB` | Text on Forest/Ink |

Semantic states should use explicit text and icons alongside color. Proposed tones: success `#276749`, warning `#946200`, danger `#A33A35`, information `#315D87`. Validate all foreground/background combinations before implementation; these are starting tokens, not certified accessible pairings.

### Color usage
- Default to Paper backgrounds with Ink text.
- Use Forest for primary calls to action and select brand moments.
- Use Sage sparingly for supporting elements and illustrations.
- Prefer subtle borders and spacing to large tinted containers.
- Code blocks and technical demos may use Ink or deep Forest surfaces.
- Keep a single strong accent per screen where possible.

### Dark theme (proposed)

| Token | Hex |
|---|---|
| Background | `#171C19` |
| Surface | `#222A25` |
| Border | `#39463D` |
| Text | `#F3F3EC` |
| Muted text | `#B8C4B9` |
| Accent | `#91B69B` |

Use light and dark themes as intentional compositions. Avoid direct inversion of the light palette.

## 3. Logo identity

### Creative direction
A restrained geometric mark that suggests transfer, continuity, or two parties connecting. Pair it with a carefully spaced lowercase **porden** wordmark.

### Logo variants to develop
1. Primary horizontal lockup: symbol + lowercase wordmark.
2. Wordmark-only version for headers and documentation.
3. Symbol-only version for favicon, avatars, and small app icons.
4. Single-color versions in Forest, Ink, and Paper.

### Construction rules
- Prioritize recognition at 16–24 px.
- Use simple geometry and deliberate negative space.
- Ensure the mark works without gradients, shadows, or animation.
- Keep sufficient clear space, provisionally equal to the height of the wordmark's lowercase `o` on all sides.
- Avoid literal robot heads, sparkles, circuit brains, and generic infinity loops.

**Important:** The previously generated two-part directional symbol is an exploration, not a finalized or trademark-cleared logo. Final vectors, clear-space measurements, and minimum sizes must be established after selection.

## 4. Typography

### Proposed type stack
- **Interface and marketing:** Geist or Inter. Choose one after visual testing; Inter is a safe initial implementation.
- **Code and technical metadata:** IBM Plex Mono.
- **Fallback:** system sans-serif / monospace.

### Hierarchy principles
- Strong headings with compact line heights.
- Readable body text, typically 16–18 px on marketing pages and 14–16 px in dense application views.
- Avoid ultra-light weights and decorative display fonts.
- Use monospaced type for IDs, code, timestamps, and structured evidence, not entire paragraphs.

## 5. Imagery and graphic language

### Preferred
- Clear flow diagrams showing task movement and ownership.
- Technical-manual-inspired linework and restrained annotations.
- Real interface captures and code examples.
- Subtle print texture in marketing compositions when it does not impair legibility.
- Geometric forms drawn from the final logo system.

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

**CTA ideas:** “Read the docs”, “Explore the API”, “See a handoff”.

Avoid claiming guaranteed delivery, perfect traceability, or complete accountability until the implementation supports those promises.

## 7. Brand applications

### Website
Paper background, confident typography, Forest highlights, interactive handoff examples, real documentation excerpts.

### Documentation
Navigation-first layout, high legibility, copyable snippets, restrained syntax highlighting, clear API contracts.

### SDK / CLI
Simple, predictable naming and human-readable errors. `@porden/sdk` is a **proposed** package name; package scope availability is unverified.

### Social / GitHub
Use the symbol-only logo on Forest or Paper. Keep cover imagery typographic and product-led.

## 8. Brand governance and open decisions

**Decided:** Porden name as working product brand; Forest & Paper palette; grounded developer-tool aesthetic; light-first interface.

**To validate:** trademark and domain clearance; package/organization availability; final logo originality; exact typeface licensing; WCAG contrast; final tagline; dark theme; illustrations and motion.

Keep `design.md` as the implementation companion to these brand guidelines. Update both when visual decisions are approved.
