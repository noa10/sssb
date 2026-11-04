# c70ef1da-ac81-4501-b65b-142844b1dbed implementation handoff

This archive is the source of truth for turning the design into production code. The website files now live under `public/`; paths in the original handoff below are relative to that directory. Start from `public/index.html`, then preserve the visual system, responsive behavior, and interactions found in the exported files.

## Implementation target
- Build production UI from the exported design, not a loose reinterpretation.
- Preserve typography scale, spacing rhythm, color tokens, border radii, shadows, motion timing, and component states.
- Replace static placeholders only when the target app has real data or functional equivalents.
- Keep generated product UI free of OpenDesign chrome, preview labels, or design-process annotations.
- Treat this handoff as a visual contract: if implementation choices conflict, match the exported pixels and behavior first, then refactor internals.

## Source map
- Primary entry: `index.html`
- HTML screens detected: 14 (13 active pages and one legacy redirect)
- Stylesheets detected: 2
- Script/component files detected: 1
- Supporting assets detected: 69

## Responsive contract
Validate the implementation across this 2025–2026 viewport matrix:
- Mobile compact: 360×800
- Mobile standard: 390×844
- Mobile large: 430×932
- Foldable / small tablet: 600×960
- Tablet portrait: 820×1180
- Tablet landscape: 1024×768
- Laptop: 1366×768
- Desktop: 1440×900
- Wide desktop: 1920×1080

For responsive web exports, treat these as a modern breakpoint system for one adaptive web experience, not three fixed screenshots. Do not split responsive web into unrelated native app screens unless the project explicitly includes native targets. Use semantic layout thresholds, fluid `clamp()` type/spacing, and container queries where component width matters more than viewport width. Preserve any CSS media queries, container queries, fluid `clamp()` scales, and layout changes already present in the exported files.

## Design fidelity contract
- Extract reusable tokens before writing components: background, surface, foreground, muted text, border, accent, radius, shadow, spacing, type scale, and motion duration/easing.
- Map product screens, in-app modules/components, optional landing page, and optional OS widget surfaces before coding. Keep these surfaces separate in the target architecture.
- Match layout geometry: max-widths, gutters, grid columns, card proportions, sticky/fixed elements, and viewport-specific navigation.
- Preserve real copy, labels, and data shown in the export. Do not replace specific text with generic marketing filler.
- Preserve interactive affordances: hover, focus, pressed, disabled, loading, validation, copy/share, tab/accordion, modal/sheet, and keyboard states where present.
- Preserve accessibility semantics when converting: headings stay hierarchical, controls remain buttons/links/inputs, focus states stay visible.
- Do not keep prototype-only annotations, frame labels, or OpenDesign chrome in the production UI.

## CJX-ready UX contract
- Use `DESIGN-MANIFEST.json` as the machine-readable map for screens, app modules, OS widgets, landing pages, tokens, interactions, and viewport checks.
- Screen-file-first: when multiple user-facing surfaces exist, implement each HTML screen as its own route/file. Treat `index.html` as a launcher/overview when the manifest marks it that way, not as a combined final UI.
- If `landing.html`, app screens, platform screens, or OS widget files exist, preserve those boundaries in the target app instead of merging them into one page.
- A single self-contained `index.html` is acceptable only when the export truly contains one user-facing screen and its CSS/JS are structured enough to extract tokens, components, states, and behavior.
- If separate `css/` or `js/` files exist, treat them as source of truth for token/component/interactions before porting to React, Vue, SwiftUI, Compose, or another target stack.
- In-app modules/components are product UI blocks inside the app. OS widgets are home-screen/lock-screen/quick-access surfaces outside the app. Do not merge those concepts.

## Color and brand contract
- Use the exported design tokens and product/domain context as the color source of truth.
- Do not introduce warm beige / cream / peach / pink / orange-brown background washes unless they are already explicit brand/reference colors in the export.
- A stylesheet or design/token file was detected; inspect it for canonical color variables before choosing framework theme tokens.

## Implementation sequence for AI coding tools
1. Open `index.html` and `DESIGN-MANIFEST.json`; identify every screen file, launcher/overview file, app module, and interaction before coding.
2. If multiple HTML screens exist, map them to separate routes/surfaces first; do not merge `landing.html`, product app screens, platform screens, or OS widgets into one route.
3. Extract a token table from CSS/root styles and inline styles before building framework components.
4. Build product screens and domain-specific in-app modules from largest layout regions down to controls; avoid starting with isolated atoms that lose spatial intent.
5. Port responsive behavior across the modern viewport matrix and test each semantic breakpoint before cleanup.
6. Port interactions and states, then replace static placeholders only with real app data or functional equivalents.
7. Keep optional landing page and OS widget surfaces as separate surfaces if present.
8. Compare final screenshots against the export at 360×800, 390×844, 430×932, 820×1180, 1024×768, 1366×768, 1440×900, and 1920×1080 before declaring done.

## Entry points
- `about.html`
- `contact.html`
- `diving-equipments.html`
- `fxc.html`
- `index.html`
- `inflatable-boats.html`
- `jfd.html`
- `other-tradings.html` — redirect to `products.html`
- `our-policy.html`
- `parachute-systems.html`
- `products.html`
- `safe-at-sea.html`
- `seacraft.html`
- `shark-marine.html`
- `zodiac-nautic.html`

## Styles
- `assets/css/styles.css`
- `assets/css/products.css`

## Scripts/components
- `assets/js/site.js`

## Assets and supporting files
- `assets/brochures/fxc-company-overview.pdf`
- `assets/brochures/jfd-company-overview.pdf`
- `assets/brochures/safe-at-sea-rescuerunner-brochure.pdf`
- `assets/brochures/seacraft-product-catalogue.pdf`
- `assets/brochures/sources.json`
- `assets/brochures/zodiac-nautic-brochure.pdf`
- `assets/data/products.json`
- `assets/fonts/LICENSE-NOTES.txt`
- `assets/fonts/archivo-latin.woff2`
- `assets/fonts/ibm-plex-mono-400.woff2`
- `assets/fonts/ibm-plex-mono-500.woff2`
- `assets/img/about-company.jpg`
- `assets/img/about-team.jpg`
- `assets/img/card-boats.jpg`
- `assets/img/card-diving.jpg`
- `assets/img/card-parachute.jpg`
- `assets/img/card-trading.jpg`
- `assets/img/companies/fxc-logo.jpg`
- `assets/img/companies/jfd-logo.jpg`
- `assets/img/companies/jfd-products.jpg`
- `assets/img/companies/safe-at-sea-logo.jpeg`
- `assets/img/companies/safe-at-sea-rescuerunner.png`
- `assets/img/companies/seacraft-logo.png`
- `assets/img/companies/zodiac-logo.jpg`
- `assets/img/contact-office.jpg`
- `assets/img/credits.json`
- `assets/img/favicon.png`
- `assets/img/hero-mission.jpg`
- `assets/img/policy-operations.jpg`
- `assets/img/products/fxc-mc4.jpg`
- `assets/img/products/fxc-model-12000.jpg`
- `assets/img/products/fxc-model-2101.jpg`
- `assets/img/products/fxc-t10d.webp`
- `assets/img/products/jfd-enforcer.jpg`
- `assets/img/products/jfd-shadow.jpg`
- `assets/img/products/jfd-stealth-mr.jpg`
- `assets/img/products/jfd-stealth-sc.jpg`
- `assets/img/products/safe-at-sea-elecorunner.jpeg`
- `assets/img/products/safe-at-sea-guardrunner.png`
- `assets/img/products/safe-at-sea-rescuerunner.png`
- `assets/img/products/safe-at-sea-saferunner.png`
- `assets/img/products/seacraft-enc3-pro.png`
- `assets/img/products/seacraft-future.png`
- `assets/img/products/seacraft-ghost.png`
- `assets/img/products/seacraft-go.png`
- `assets/img/products/zodiac-medline68.webp`
- `assets/img/products/zodiac-open55.webp`
- `assets/img/products/zodiac-open65.webp`
- `assets/img/products/zodiac-pro55.webp`
- `assets/img/proj-aka.jpg`
- `assets/img/proj-cargo.jpg`
- `assets/img/proj-diving.jpg`
- `assets/img/proj-dpv.jpg`
- `assets/img/proj-jwa.png`
- `assets/img/proj-kirby.png`
- `assets/img/proj-navigation.jpg`
- `assets/img/proj-parachute.jpg`
- `assets/img/proj-tactical.jpg`
- `assets/img/proj-typev.png`
- `assets/img/proj-ufast.jpg`
- `assets/img/proj-zodiac.jpg`
- `assets/img/sssb-logo.png`
- `assets/img/team-azizan.jpg`
- `assets/img/team-ghani.jpg`
- `assets/img/team-limbach.jpg`
- `assets/img/team-malek.jpg`
- `assets/img/team-shuhaimi.jpg`
- `assets/img/team-yusuf.jpg`
- `assets/img/team-zolkopli.jpg`

## Coding checklist for AI tools
1. Inspect `index.html` and `DESIGN-MANIFEST.json` first and identify reusable components before coding.
2. Implement each user-facing screen file as its own route/surface; keep launcher, landing, app, platform, and OS widget files separate.
3. Extract design tokens into the target stack: colors, type scale, spacing, radius, shadows, and motion.
4. Implement layout with real 2025–2026 responsive breakpoints, fluid type/spacing, and container-query-aware component behavior; test with no horizontal overflow.
5. Preserve interactive controls, hover/focus/pressed states, form behavior, validation, and copy actions where present.
6. Implement domain-specific in-app modules with real states; do not flatten them into generic cards.
7. Keep landing page, product screens, and OS widget/quick-access surfaces separate when present.
8. Confirm the production result visually matches the exported design before refactoring internals.
9. Reject implementation shortcuts that flatten the design into generic cards, generic gradients, placeholder stats, or framework-default typography.
10. If a detail is ambiguous, keep the exported HTML/CSS/JS behavior rather than inventing a new pattern.

## Current product structure
- `products.html` is the full catalogue entry point. Desktop/mobile navigation and footers use the same three category routes.
- Diving Equipment: JFD, Seacraft and Shark Marine; Parachute Systems: FXC; Inflatable Systems: Zodiac Nautic and Safe at Sea.
- Each company page has an introduction and individual product listings with photographs, specifications, key features and manufacturer references.
- `assets/data/products.json` records verified product details, category mapping and company profiles. Keep static directories, model counts, company pages and contact options in agreement with it.
- Company and model enquiry links open chat with a matching suggested message. Unknown query values are ignored; visitors can edit the message before sending.
- The contact page directs visitors to the chat or the office contact details. The old `other-tradings.html` URL redirects to the current catalogue.
