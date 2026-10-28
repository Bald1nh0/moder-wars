# Changelog

## 2026-10-28

### 0.28.3

- Complete Russian and Ukrainian interface dictionaries and connect menus, settings, editor controls, tooltips, accessible labels and dynamic gameplay messages.
- Localize built-in country names and map operation labels while preserving scenario identifiers and user-authored content.
- Persist language immediately, restore it on reload and refresh active interface elements when switching languages.
- Add translation coverage, interpolation, attribute and language-switching regression checks.

### 0.28.2

- Fix missing unit flags and country colors on large or high-DPI displays: compare rounded backing dimensions before resizing Pixi canvases.
- Resume map presentation after returning to a tab while editing an active or completed conflict in God Mode.
- Add regressions using real Pixi canvas sizing at fractional rendering resolutions and visibility transitions.

### 0.28.1

- Bound map rendering resolution and camera overscan consistently across Canvas, WebGL and coastline masks to reduce memory pressure on phones and large displays.
- Release owned graphics contexts and detached Canvas backing stores; reuse bounded gradient textures and evict unused flag textures.
- Decode coastline and river assets correctly whether HTTP has already decompressed them; allow bounded coastline retries after transient failures.
- Keep valid multi-row formation retreat targets stable across repeated orders and reassign destinations when their cells become hostile.
- Repair outdated formation/retreat fixtures and include key AI and rendering-budget regressions in the standard check suite.
- Update Vite to 8.3.5 and advance the application/offline cache version together.

Browser tab crashes reported as "Aw, Snap!" have not been tied to a specific
crash dump. Rendering budgets and lifecycle fixes mitigate confirmed resource
issues; real-device testing remains necessary.
