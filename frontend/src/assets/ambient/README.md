# Ambient study imagery

Drop image files in this folder and the hero's ambient layer picks them up
automatically — `LandingHero3D.tsx` globs `*.{jpg,jpeg,png,webp,avif}` here at
build time. No code change or manifest edit is needed to add or remove one.

The layer renders nothing while this folder is empty, so the hero is fully
functional without it.

## What to add

Up to **15** files. Beyond that they are ignored — there are only 15 placement
slots, kept clear of the headline and the 3D object.

Subjects, per brief §7.7: studying, exam prep, focused work, frustration,
relief, group study, a late-night desk. Atmosphere, not a gallery.

Name them so they sort predictably, e.g. `01-late-night-desk.jpg`,
`02-group-study.jpg`. Sort order maps to placement order.

## Licensing

**Only properly licensed sources.** Unsplash, Pexels, or equivalent — or
photography you own. Do not scrape image search results. If a source requires
attribution, record it in the table below.

| File | Source | Licence | Attribution required |
| --- | --- | --- | --- |
| _(none yet)_ | | | |

## Treatment

Do not pre-process. The layer applies the duotone in CSS
(`grayscale → sepia → saturate → hue-rotate`) so everything lands in the paper
palette and stops reading as raw stock photography against the flat-toon
object. It also applies the blur/fade cycle and picks up the hero's grain
overlay. Supply clean originals; the palette is applied at runtime.

Roughly 1600px on the long edge is plenty — they are never shown sharp, never
larger than ~26% of the hero, and never fully opaque.

## Photography vs illustration

§7.7 asks for both to be tried and whichever reads better against the flat-toon
object kept. The CSS duotone is tuned for photography. If illustrations are used
instead and the duotone fights them, the filter to adjust is
`.em-ambient-item img` in `App.css`.
