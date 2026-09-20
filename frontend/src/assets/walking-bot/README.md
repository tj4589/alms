# Walking bot asset contract

## Available source and current fallback

The repository contains `components/Maxe/MaxeMark.tsx`: an SVG character with front and left-facing profile poses. It is not a sprite sheet. The source remains intact. `hero.png` was visually inspected and is an unrelated decorative graphic.

The supplied attachment contains instructions only. No reference image with a backpack, arms, wires or loose mechanical components was available. Do not invent those details or claim the fallback preserves them. Request the original character image before generating final artwork.

`WalkingBotFallback.tsx` temporarily reuses the existing SVG profile. Independent legs, body bounce, antenna and a separate ground shadow demonstrate the movement contract. This is an articulated vector approximation, not final sprite artwork. It has no arm counter-swing or backpack/wire secondary motion because those parts do not exist in the available source. Contact compensation is approximate, especially while accelerating and decelerating.

## Required production sheet

Create one transparent horizontal PNG/WebP containing ten equal cells. Recommended cell size: 256 x 320 px; whole sheet: 2560 x 320 px. Face left. All cells share scale, ankle baseline, anchor point and padding (including antenna, backpack and wires). No baked shadow, label or background. Retain the original reference alongside the final sheet with provenance.

Frames in order:

1. Right-foot contact
2. Down/compression
3. Passing
4. Up/recoil
5. Left-foot contact
6. Down/compression
7. Passing
8. Up/recoil
9. Neutral, feet planted
10. Turn transition, weight settled

Frames 1–8 must form a seamless gait: arms oppose the legs, planted soles remain at the shared baseline, and antenna/backpack/wires follow the body with restrained secondary motion. Author body bounce in the frames. Neutral and turn frames are not part of the repeated walk playback.

## Integration

Pass `sprite={{ src, frameWidth: 256, frameHeight: 320, strideLength: 110 }}` to `WalkingBot`. Replace 110 with the actual source-pixel distance travelled by a complete eight-frame gait. CSS uses `steps(8)` over the first eight cells of the ten-cell strip, frame 9 for rest and frame 10 during the 340ms turn. Movement logic stays unchanged.

The stage measures its container with ResizeObserver, reserves its height, confines overflow locally and completes whole gait cycles per crossing. `travelDuration` is seconds per 500px; `pauseDuration` is seconds at each end (default 0.5). IntersectionObserver and document visibility pause playback; reduced motion shows a stationary neutral pose. Decorative instances have no pointer interaction and are hidden from assistive technology.

## Review before approval

The fallback is for visual review only. Review a complete out-and-back loop on mobile, tablet and desktop before committing. Final acceptance of silhouette, backpack, wires, opposite arm swing and exact planted-foot contact remains blocked on the missing reference and production frames. No new dependencies are required.
