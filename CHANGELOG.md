# Changelog

## 0.4.0 — 2026-11-17

Compatibility release: the plugin now survives a DSH upgrade instead of being blocked by it.

- **Declarations**: one requirement, `engines.dsh: ">=0.2.1-rc.5"` (lower bound only; the host reads `engines.dsh` before peer ranges). Peer ranges widened to match. The previous release pinned `@deepseek-ai/cordis@4.0.5` and `@deepseek-ai/dsh-workspace@0.2.1-rc.5` exactly, which the host rejects on 0.2.2.
- **Client, preferred backend**: `ctx.contextMenus.register({ target: 'workspace' })` — the public client API the built-in Rename/Delete workspace actions use. The host renders the row, owns keyboard navigation, menu dismissal and failure reporting; the action itself is data.
- **Client, fallback backend**: the previous DOM decoration, kept for hosts without that API, with tolerant selectors (no longer requires `data-menu-material`) and a duplicate guard against the legacy `data-wshub-move-top` row.
- **Localization**: menu copy for the eight host locales (`zh`, `en`, `ja`, `es`, `fr`, `de`, `ru`, `pt`), English fallback.
- **Server**: every host capability is checked at call time and reported as data (`unsupported-host`, `write-failed`), and the route maps them to clear HTTP statuses (501 / 500) instead of a generic error. A missing connection service no longer fails activation.
- **Tests**: 21 (was 10) — structured backend, DOM fallback, duplicate guard, attribute-dropping host, rejection path, localization, capability degradation, rejected durable write.
- **New**: `COMPATIBILITY.md`, this changelog, `npm run compat:matrix`, GitHub Actions CI.
- **Docs**: removed the unverified "7 KB / 8 KB" size claims; install steps now say desktop plugin manager; the deprecated package names and the migration order are documented.

## 0.3.0 — 2026-11-09

- Published as `dsh-move-up` with its own repository and Discover index.
- Exact host peer versions; English + Chinese menu copy.

## 0.2.x — 2026-10-30

- `dsh-plugin-workspace-move-top`: one-shot move-to-top through `workspaceRegistry.insertBefore`, no pins or saved state.
- `dsh-plugin-workspace-favorites` published on 2026-11-13 under a name that never matched its behaviour (move-to-top only); superseded.
