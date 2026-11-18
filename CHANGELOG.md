# Changelog

## 0.4.2 — 2026-11-18

- **The structured row now has a glyph.** 0.4.x rendered a label-only row, so on
  hosts with the structured menu the action looked different from the legacy
  build, which painted its own `↑`. The client now registers a
  `contextMenu.icon` keyed slot (`workspace.move-up`, a 14 px up arrow drawn with
  `currentColor`) and attaches `icon: { key }` to the contribution — the same
  mechanism the built-in Rename/Delete actions use. When `react` is not available
  the row simply stays label-only instead of failing.

## 0.4.1 — 2026-11-17

Follow-up to 0.4.0 after an adversarial review of the client lifecycle. Two real
defects were found and fixed; one limitation was confirmed as unfixable from the
plugin side and is now documented instead of implied.

- **Fixed**: the DOM fallback latched off. Once the structured menu registered,
  `structured` was never reset, so if the host withdrew its menu API (client entry
  replaced, HMR, plugin update) the workspace menu lost the action until a reload.
  The injected child now restores the fallback when it is disposed.
- **Fixed**: a second copy of the same bundle (two loader rows / aliases) made the
  host reject the duplicate contribution, which the client swallowed and answered
  by adding a DOM row on top of the host row — two identical actions, permanently.
  A duplicate contribution is now treated as "the host row already exists".
- **Changed**: the DOM fallback installs one turn later, so a host with the
  structured API never builds a `MutationObserver` or capture listeners for nothing.
- **Changed**: one installation per host context, even if the loader activates the
  bundle twice.
- **Documented limitation**: with the legacy package (`dsh-plugin-workspace-favorites`
  / older `dsh-plugin-workspace-move-top`) *also enabled*, the workspace menu shows
  the action twice. The legacy build paints its row into the DOM while the host
  renders ours from data, so neither side can see the other. Keep exactly one
  implementation enabled; the compatibility build `dsh-plugin-workspace-move-top@0.2.4`
  and this package are the same implementation and must not both be installed.
- Evidence: 21/21 tests, plus three real-cordis lifecycle probes (service absent,
  service withdrawn, bundle loaded twice).

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
