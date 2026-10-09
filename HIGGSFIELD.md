# Higgsfield usage

- **Budget:** 6 credits, with at least 1 kept in reserve.
- **Used:** 3.0 credits.
- **Left:** 3.0 credits. No further generations are planned.

All images were generated with **GPT Image 2.5** (`gpt_image_2_5`) and downloaded into `web/`. Nothing is loaded from Higgsfield or a CDN.

| # | what | settings | credits | file(s) |
|---|---|---|---|---|
| 1 | mascot base design, variant A (chosen) | 1:1, medium, 1k | 0.5 | `web/design-src/mascot-a.png` |
| 2 | mascot base design, variant B | 1:1, medium, 1k | 0.5 | `web/design-src/mascot-b.png` |
| 3 | homepage hero | 16:9, high, 1k, mascot A as reference | 1.5 | `web/design-src/hero-raw.png` → `web/public/brand/hero.webp` |
| 4 | social / OG image | 16:9, medium, 1k, mascot A as reference | 0.5 | `web/design-src/og-raw.png` → `web/public/brand/og.jpg` (cropped to 1200×630) |
| | **total** | | **3.0** | |

- **Transparent background.** "Transparent background" was requested for the mascot but not honoured; the outputs have a dark background. That made no difference, because the mascot was redrawn as SVG by hand (`web/src/ui/Mascot.tsx`) and the PNGs are only references.
- **Processing.** Conversion and cropping were done locally with ffmpeg. Since the finishing round, `web/public/brand/og.jpg` is rendered by `scripts/brand-images.mjs` from `og-raw.png` plus the cube and wordmark (no new generations, no credits used).

## Prompts

**1 and 2: mascot**

> Original character design of a small ice cube mascot. A rounded translucent cube with soft bevelled edges, pale ice-cyan (#7FE7F2) with lighter highlights and one small glossy reflection on the top-left edge. Simple friendly face on the front: two small oval deep-navy eyes, a tiny curved smile, faint pink blush. Front view with a slight three-quarter angle, standing still. Clean bold flat shapes, 2-3 tones of shading, uniform deep-navy (#0B1530) outline, designed to be easy to redraw as SVG. Transparent background. No text, no logo, no other characters.

**3: hero**

> Wide hero illustration for a dark website. Deep night-blue (#0A1024) background with a soft gradient and faint frost texture. On the right, the ice cube character from the reference image sits on a smooth surface, slightly melting at its base into a small glossy puddle, a thin wisp of cold vapor rising. Soft ice-cyan rim light and gentle glow; translucent frosted-glass panels float out of focus in the background. Calm, quiet, slightly playful mood, same flat-to-soft illustration style as the reference. Generous empty space on the left for a headline. No text, no letters, no logos, no UI, no padlocks, no shields.

**4: OG**

> Social share image with a centered composition. The ice cube character from the reference, front view, centered, half melted into a glossy puddle on a deep night-blue (#0A1024) background, faint frost particles, soft ice-cyan glow. Strong simple silhouette that reads at thumbnail size, lots of empty space above and below. No text, no letters, no logos.
