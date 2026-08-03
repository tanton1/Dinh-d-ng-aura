# Aura Fitness Design System 3.0

## Brand direction

Aura Fitness uses a high-contrast Black / White / Pink Neon visual language.
Black creates the premium performance foundation, white keeps dense learning
and coaching workflows readable, and Pink Neon identifies the next action.

Pink Neon is not a page background. Reserve it for the brand mark, active
navigation, focus, progress and exceptional calls to action.

## Canonical tokens

| Token | Value | Usage |
| --- | --- | --- |
| `--aura-black` | `#09090B` | Navigation, immersive surfaces |
| `--aura-white` | `#FFFFFF` | Content surfaces |
| `--aura-canvas` | `#F6F6F7` | App background |
| `--aura-pink-neon` | `#FF2D91` | Accent on black, active state |
| `--aura-pink` | `#D90068` | Buttons with white text |
| `--aura-pink-dark` | `#B50055` | Hover/pressed button |
| `--aura-pink-soft` | `#FFF0F7` | Selected/focus surface |
| `--ink` | `#111114` | Primary text |
| `--muted` | `#6D6871` | Supporting text |
| `--line` | `#E7E3E8` | Borders and separators |

Success, warning, danger and information keep their semantic green, amber,
red and blue colors. They must not be recolored pink.

## Layout

- Desktop from 1200px: 248px sidebar and 72px topbar.
- Tablet from 768px to 1199px: persistent 76px navigation rail.
- Mobile below 768px: 56px topbar and 68px bottom dock plus safe area.
- Content maximum width: 1440px.
- Gutter: 36px desktop, 26px tablet, 16px mobile.

## Typography and controls

- Page title: 30–40px desktop, 26–28px mobile.
- Section heading: 20px.
- Body: 14–15px.
- Supporting labels: never below 11px in the shell; target 12px in product surfaces.
- Desktop controls: minimum 44px.
- Mobile primary controls: minimum 48px.
- Mobile text inputs: 16px to avoid automatic browser zoom.

## Interaction rules

- One visually dominant primary action per screen.
- Every active navigation item uses icon, label and color—not color alone.
- Sheets and drawers must close with Escape, restore focus and protect page scroll.
- Preserve semantic colors and always pair status color with text or an icon.
- Respect `prefers-reduced-motion` across the whole app.
- Avoid page-level horizontal scrolling at 320–430px.

## Implementation

The migration layer lives in `src/styles-aura.css` and is loaded after the
legacy styles. New work should use canonical Aura tokens directly. Legacy
`--purple*` aliases remain temporarily so existing screens inherit the new
brand without a risky all-at-once rewrite.
