# Aura Fitness Design System 4.1

## Brand direction

Aura Fitness uses a warm pink-to-orange gradient on light surfaces, with near
black navigation. White keeps dense learning and coaching workflows readable,
and the gradient identifies the next action.

The gradient is not a page background. Reserve it for the brand mark, active
navigation, progress and the primary call to action.

## Canonical tokens

`src/styles-aura-tokens.css` is the source of truth and is loaded last.

| Token | Value | Usage |
| --- | --- | --- |
| `--aura-brand-pink` | `#EC2C76` | Brand mark, decoration, icons. Not for small text |
| `--aura-brand-orange` | `#FF7A45` | Brand mark, decoration. Never for text |
| `--aura-pink-text` | `#C2185B` | Pink text: 5.87:1 on white, 5.33:1 on pink-soft |
| `--aura-gradient-cta` | `#D6186E` → `#C2410C` | Buttons with white text: at least 4.98:1 and 5.18:1 at its ends |
| `--aura-pink-soft` | `#FFF0F6` | Selected/focus surface |
| `--aura-ink` | `#19161A` | Primary text |
| `--aura-muted` | `#5F5961` | Supporting text: 6.8:1 on white |
| `--aura-line` | `#ECE8EC` | Borders and separators |
| `--aura-canvas` | `#F7F4F6` | App background |
| `--aura-surface` | `#FFFFFF` | Content surfaces |
| `--aura-text-xs` … `--aura-text-2xl` | 12, 14, 16, 20, 26, 32px | Type scale |
| `--aura-space-1` … `--aura-space-8` | 4, 8, 12, 16, 24, 32px | Spacing rhythm |
| `--aura-touch-target` | 44px | Minimum control height |

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
- Supporting labels: never below 12px on member screens.
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

`src/styles-member-foundation.css` enforces minimum text size, touch targets
and accessible brand colors on existing member screens. It is a migration aid:
new member UI should use the tokens directly instead of being added to its
lists. `tests/e2e/student-shell-layout.spec.ts` guards these rules.
