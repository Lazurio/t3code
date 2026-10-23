# Lazurio brand assets

Lazurio's brand assets in this repository are `symbol-color.svg` and `symbol-color-dark.svg` in
this folder and `apps/web/public/assets/avatar.webp`. The MIT License in the repository's `LICENSE`
does not cover them, and all rights in them are reserved. They may be used only to identify Lazurio
and Buddy in Lazurio's own distribution of T3 Code. A fork outside Lazurio must replace them.

`symbol-color.svg` and `symbol-color-dark.svg` are the Lazurio symbol for light and dark ground,
copied unchanged from the Lazurio design system (`content/brand/logo/`, at `22265ef2`). The logo
manual allows only the whole approved asset: never edit, redraw or recolour these files. To update
them, copy the new approved files over these. LazurioPlatform vendors the same light symbol in
`src/shell/vendor/lazurio/`.

`apps/web/public/assets/avatar.webp` is Mattyčus, Buddy's default character, for Buddy's surface
and the Lazurio shell's Buddy launcher, which loads it from Buddy's origin at `/assets/avatar.webp`
(Matěj's approval of 2026-10-22, plan DEV-6676). It is `content/brand/buddy/mattycus-idle.png` of
the design system (at `d65ecf3c`, sha256 `5ea4b58d…48b5bc`), re-encoded as lossless WebP with the
same pixels. The design system allows Mattyčus only on Buddy and Guide surfaces.
