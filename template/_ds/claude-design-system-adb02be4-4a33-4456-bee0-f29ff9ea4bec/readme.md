# Elkit Design System

Design system for **Claude** (Anthropic's consumer/developer AI product line), built entirely from a provided `design.md` brand specification (color/type/spacing/component tokens + written brand guidelines). No Figma file, codebase, or slide deck was attached — this system is spec-driven, not code-extracted.

**Source:** a single pasted `design.md` document (`awesome-design-md/claude`, v1.0.0) containing YAML front-matter tokens plus prose guidelines. No Figma link, GitHub repo, or local codebase was provided. If those become available, re-run against them to replace token guesses with ground truth.

## Index
- `styles.css` — root stylesheet, imports everything under `tokens/`.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `radius.css`, `shadow.css`, `motion.css`, `fonts.css`.
- `components/` — reusable primitives, grouped by concern:
  - `buttons/` — Button (primary/secondary/secondary-on-dark/text-link), IconButton
  - `inputs/` — TextInput
  - `tabs/` — CategoryTab
  - `badges/` — Badge (neutral/coral)
  - `navigation/` — TopNav
  - `cards/` — FeatureCard, HeroIllustrationCard, ProductMockupCardDark, CodeWindowCard, ModelComparisonCard, PricingTierCard, CalloutCardCoral, ConnectorTile, CookieConsentCard
  - `sections/` — HeroBand, CtaBand, Footer
- `ui_kits/marketing-site/` — click-through recreation of the claude.com marketing site (hero, features, product mockups, pricing, footer, cookie banner).
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand groups in the Design System tab).
- `assets/` — brand mark note (see Iconography below — no logo files were provided).
- `SKILL.md` — Claude-Code-compatible skill wrapper for this system.

## Content Fundamentals
- **Voice:** editorial and calm, not hypey. Sentences read like considered prose ("Meet your thinking partner"), not exclamation-heavy marketing copy.
- **Address:** direct second person ("you") in body copy; first person plural ("we") when Anthropic speaks about itself/policy.
- **Casing:** sentence case everywhere — headlines, buttons, nav labels. Never title-case or ALL CAPS, except the intentional uppercase treatment on `caption-uppercase` (badges/eyebrows), which leans on letter-spacing rather than heavy weight.
- **Length:** short. Headlines run 2–6 words ("Build with Claude," "Start building today"). Body copy under CTAs is one sentence.
- **Emoji:** none. The brand voice is literary/considered; emoji would undercut that.
- **Vibe:** warm, human, a little literary — closer to a thoughtful essay than a SaaS landing page. Confidence comes from restraint (short copy, generous whitespace), not superlatives.

## Visual Foundations
- **Color:** neutral slate canvas (`--color-canvas`) is the base. Blue-600 (`--color-primary`) is the single brand accent: reserved for primary CTAs and full-bleed callout bands, never sprinkled across icons or small UI accents. Dark navy (`--color-surface-dark`) is the third surface, used for product-chrome mockups (code windows, settings panels), not as a dark theme.
- **Type:** serif display (Cormorant Garamond, substituting for the licensed Copernicus) at weight 400 with negative letter-spacing (-0.3 to -1.5px) for every headline; humanist sans (Inter, substituting StyreneB) for body/nav/buttons at 400/500 weight; JetBrains Mono for all code. Never bold the serif display.
- **Spacing:** 96px between major page bands (`--space-section`); 32px internal card padding. Rhythm, not density, is the goal — cards breathe.
- **Backgrounds:** flat color fields only. No photography-first hero, no gradients, no repeating textures/patterns. When imagery appears it's line-art or real product chrome (code editors, terminal output), rendered on a flat cream or navy field.
- **Animation:** no documented motion system beyond generic UI durations (`--duration-fast/normal/slow`, 150/240/400ms, standard easing). The spec calls out that message-reveal/typewriter/agentic-flow timing is out of scope — treat included motion tokens as safe defaults, not brand signatures.
- **Hover/press states:** minimal by design. Primary button darkens to `--color-primary-active` on press; nothing else changes. The system explicitly avoids inventing additional hover treatments (no lift, no glow, no opacity fade) — restraint is the point.
- **Focus states:** text input border shifts from hairline to coral (`--border-focus`) with a soft ~3px coral-at-15% ring — the one interactive state fully specified.
- **Borders:** 1px hairline (`--color-hairline`) reads as "one elevation step," not an ink line. Used on inputs, sub-nav, occasionally cards.
- **Shadows:** almost none. Depth comes from surface-color contrast (cream vs. cream-card vs. dark-navy) rather than elevation shadows. The one documented shadow (`--shadow-md`, `0 1px 3px rgba(20,20,19,.08)`) is reserved for rare hover-elevated states.
- **Transparency/blur:** none documented — no glass/blur surfaces in this spec.
- **Imagery color vibe:** warm-neutral when present (coral + dark-navy line-art on cream); no photography in the source spec, so no grain/warmth-of-photo guidance to give.
- **Corner radii:** 4px (badge accents) → 6px (small buttons) → 8px (CTA buttons, inputs, tabs) → 12px (content cards) → 16px (hero illustration container) → pill/9999px (badges, avatars, circular icon buttons).
- **Cards:** flat surface-color fills (cream-card or dark-navy), 12px radius, no border in most cases (hairline border appears occasionally, e.g. `HeroIllustrationCard`, `ModelComparisonCard`), no shadow.
- **Layout:** single 12-column grid, ~1200px max content width, centered. Hero is a 6/6 split (copy left, illustration/mockup right). Feature grids 3-up, connector tiles 4–6-up, pricing 3-up — all collapsing toward 1-up on mobile by reducing column count, never shrinking card scale.

## Iconography
No icon assets, icon font, or SVG sprite were provided in the source `design.md` — it only documents a single inline glyph: the **Anthropic radial-spike mark** (a 4-spoke asterisk, `✳`), used as a wordmark prefix and occasional inline content marker. It is treated as a logo asset, not a formalized icon token, and is never inverted to white-on-dark within the wordmark.
- **No logo files were supplied** — components render the wordmark as plain type ("Elkit") with the `✳` glyph as a placeholder mark. Do not treat this glyph as the real Anthropic logo; replace it with the actual mark asset as soon as one is provided.
- **No general UI icon system is documented** (no arrows/chevrons/social-icon set in the spec). Where a UI needs a generic icon (e.g. carousel arrows on `IconButton`), this system falls back to a plain Unicode glyph (`→`) rather than inventing SVGs.
- **Recommendation:** if a broader icon set is needed, [Lucide](https://lucide.dev) (CDN: `https://unpkg.com/lucide-static/icons/`) is the closest stylistic match (thin, humanist stroke) — flagged here as a substitution, not sourced from the brand.
- **Emoji:** not used anywhere in the brand.

## Components
Button, IconButton, TextInput, CategoryTab, Badge, TopNav, FeatureCard, HeroIllustrationCard, ProductMockupCardDark, CodeWindowCard, ModelComparisonCard, PricingTierCard, CalloutCardCoral, ConnectorTile, CookieConsentCard, HeroBand, CtaBand, Footer.

This inventory mirrors the `components:` block in the source `design.md` one-for-one (its `-active`/`-disabled`/`-focused` state variants collapsed into props: `Button variant`, `PricingTierCard featured`, `TextInput` built-in focus state).

## Caveats
- **Fonts are substitutes.** Copernicus and StyreneB are licensed Anthropic typefaces not publicly available; this system uses Cormorant Garamond and Inter (Google Fonts) as the closest open substitutes, loaded via `tokens/fonts.css`. Swap in the real font files if you have licensed access.
- **No logo/icon assets provided** — see Iconography above.
- **No codebase or Figma was attached**, so components/UI kit are built from the written spec only, not extracted from real markup — treat pixel values as best-effort interpretations of the token spec, not verified production values.
- **Only one product surface** (the claude.com marketing site) is covered by the UI kit — the spec doesn't describe the claude.ai chat product surface in enough detail to recreate it.
