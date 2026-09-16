---
name: ExamMind public landing
description: A photographic academic landing page that moves from warm paper into a dark reading room.
colors:
  paper: "#f8f5ee"
  ink: "#252b24"
  action: "#bd461e"
  clay: "#eadbca"
  brown: "#6c3e2e"
  forest: "#191d19"
  lime: "#dce5b5"
typography:
  display:
    fontFamily: "Outfit Variable"
    fontWeight: 500
    lineHeight: 1.04
    letterSpacing: "-0.04em"
  emphasis:
    fontFamily: "Instrument Serif"
    fontWeight: 400
  body:
    fontFamily: "Outfit Variable"
    fontSize: "16px"
    lineHeight: 1.6
rounded:
  control: "999px"
  card: "28px"
  step: "25px"
---

## Overview

Public landing only. This surface supersedes the landing-specific rules in the older MASTER.md, including the WebGL hero, backdrop wordmark, and single dark switch. Authenticated screens retain their existing paper system.

The user approved the photographic hero and requested more stock images and illustrations, greater 3D depth, selected rounder cards and buttons, continuous scroll dimming, and a navbar that becomes a pill on scroll.

## Colors

The hero stays on cream paper. With ordinary motion preferences, all four content chapters share one continuous background, scrubbed from paper through clay and brown to forest-black. Foreground colours switch according to background luminance; middle tones use black or white for contrast. Cards preserve their own fixed contrasting text and surface colours.

Reduced-motion mode shows each chapter's stable background without scroll colour interpolation. The final action and footer use #151915. Do not extend this dark treatment into the authenticated application.

## Typography

Outfit is self-hosted and used throughout the landing. Instrument Serif italic provides editorial emphasis. The hero holds two lines at verified widths of 390, 768, 1024 and 1440px. Display headings range from about 44px on mobile to 80px on desktop. Product examples remain clearly labeled as illustrative.

## Layout

The maximum content width is 1280px. Desktop uses an asymmetric copy/photo hero, a two-column feature grid with a full-width third card, a sticky workflow introduction with stacking steps, a source-integrity statement, and photographic student scenarios. Mobile collapses the grids and disables stacking.

The shared journey background has no hard section seams when motion is enabled. Major desktop sections use 100–140px vertical padding; mobile uses approximately 75–85px.

## Elevation & Depth

The hero uses CSS perspective with separate z-depths for the backing, main portrait, note photo, answer card, bulb and folder. Fine-pointer movement is eased with GSAP quickTo. Decorative movement never intercepts input and respects reduced motion. The hero requires no WebGL context.

Photography comes from Pexels; the 3D illustrations originate from Vijay Verma's CC0 3dicons. Bulb and folder cutouts were prepared with the built-in image tool. Source credits and exact edit prompts live in frontend/public/images/landing/CREDITS.md.

## Shapes

Primary buttons use full pill radii. Feature cards use 28px corners, workflow cards 25px, and photographs use larger softened corners. The hero retains its asymmetric upper-left curve. These shapes are local to this landing page.

## Components

- Navigation: flush at the top; above 48px scroll, it contracts to a 72px-high floating pill, or 60px on mobile. Its parent retains a fixed height to prevent layout jumps. The mobile menu has accessible expanded state and Escape handling.
- Answer preview: three sample subjects, live answer updates, expandable source excerpts. Do not imply the examples are live account data.
- Workflow: desktop cards progressively stack; narrow layouts and reduced motion show the complete normal document flow.
- Student scenarios: explicit previous/next controls; no autoplay and no invented testimonials.
- Signup/login: existing application callbacks remain the navigation mechanism. Scroll resets on entry to authentication.

## Do's and Don'ts

Keep the approved hero's copy, imagery, warm palette and hierarchy when refining. Use actual study photography with local files and recorded attribution. Preserve readable content in reduced-motion and no-animation states. Do not replace real account data or add unverified metrics, endorsements or product promises.
