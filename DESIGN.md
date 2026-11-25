# DESIGN.md

## Direction (locked 2026-11-20; change only with Julian's yes)
- **Subject:** One window on my PC for RGB lighting, fan curves and live sensors. Replaces SignalRGB. A frosted glass window over the desktop, precise and calm. The lighting itself carries the color, as a faint glow behind the glass.
- **Palette (60/30/10):**
  - 60% base: Windows 11 acrylic behind a `rgba(8,9,10,.62)` page tint (`#0a0b0c` solid when glass is off, `html.flat`)
  - 30% support: frosted panels `rgba(22,24,27,.55)` + blur 26 px, fills `rgba(255,255,255,.045)`, nav `rgba(10,11,12,.3)`
  - 10% accent: `#8fd3e0` pale cyan, for focus, the live fan curve and meters
  - Text `#e6e7e8`, soft `#9aa0a6`, dim `#6c7177`, ok `#7fd49b`, warn `#f0a35e`, bad `#ff6b5e`.
  - Ambient glow `--glow` (default `#c8323c`) follows the current lighting color at 5 to 9% alpha. It is the only place lighting colors touch the UI.
- **Type:** IBM Plex Sans 14/1.45 body, IBM Plex Mono for labels (11 px uppercase, .08em, soft color), readouts and the brand (12 px, .24em), tabular numbers. Both are bundled in `renderer/fonts` (400 and 500, OFL); 500 covers bold. Controls 13 px.
- **Layout:** Nav 200 px. Glass panels radius 12, padding 16, 1 px line, inner top highlight. Buttons and inputs 34 px high, radius 8; segmented control radius 9 with 6 px buttons; chips and tags pill; toggles 40x22. Sheet `min(460px, 100% - 48px)`, radius 16, blur 34 px, the one drop shadow. Scrim blur 10 px.
- **Motion:** CSS only, with one exception: the splash ring is a JS spring (`renderer/splash.js`, Julian's yes 2026-11-24) so it fills without stops or jumps. Sheet slides in .18 s ease-out. Meters .4 s, ambient glow .5 s, toggles .15 s, status dots .25 s. Reduced motion turns off every transition and animation.
- **References:**
  - Glass mock: https://claude.ai/artifact/Qw3Yuiemh5nR6RXFqKHjj8 (session "KelvinRGB: glass redesign of the whole app", branch `redesign/glass`).
  - `mock/Main.dc.html`, `Lighting`, `Devices`, `Cooling`: the pre-glass mock (2026-10-28), layout only.
- **Never:** Lighting preset colors in the UI chrome (only the faint glow). A blur filter on the glow (it is a tint, not a fog). Webfonts from the network. Neon.

## Tokens
CSS custom properties that match the direction. Mocks and the app both use these. Source: `renderer/style.css` on `redesign/glass`.

```css
:root{
  --acc:#8fd3e0; --ink:#e6e7e8; --soft:#9aa0a6; --dim:#6c7177;
  --line:rgba(255,255,255,.08); --line2:rgba(255,255,255,.12);
  --glass:rgba(22,24,27,.55); --glass2:rgba(255,255,255,.045);
  --ok:#7fd49b; --warn:#f0a35e; --bad:#ff6b5e; --glow:#c8323c;
  --mono:'IBM Plex Mono',ui-monospace,Consolas,monospace;
  --sans:'IBM Plex Sans','Segoe UI',system-ui,sans-serif;
}
/* page tint rgba(8,9,10,.62); flat #0a0b0c; panel blur(26px) saturate(150%) */
```

## Standing checks
One line each, checked on every mock and build:
- Tap targets at least 44 px where touch matters; text contrast at least 4.5:1 on the glass over a bright desktop.
- No em dashes in any copy.
- Plex loads from the bundled files (check on a PC without Plex installed). Done on `redesign/glass` (3eb82fb).
- SVG text in app.js uses `var(--mono)`, never a hard-coded font.
- Numbers tabular. Lighting colors never tint the interface beyond the ambient glow.
- A swatch that shows a colour value (quick colours, device chips, the Lighting pad) is content, not chrome. Selected rings on swatches use `--ink` and give way to the focus ring.
- Check with glass on and off (`html.flat`).
- Progress never runs ahead of the truth: a ring or bar may ease toward the running step's end, but reaches it only when that step is done.
