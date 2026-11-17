# Compatibility

What this plugin promises, how that promise is checked, and what happens when a DSH release moves an API.

## The declaration

`package.json` declares exactly one host requirement:

```json
"engines": { "dsh": ">=0.2.1-rc.5", "node": ">=22" }
```

The host applies `engines.dsh` **before** peer ranges (`dsh-app-boot` → `unmetRequirements`). With no upper bound, a DSH upgrade cannot block the plugin from loading; the plugin is responsible for degrading honestly, and it does (see the table below). Peer ranges repeat the same lower bound so npm/pnpm resolution agrees:

```json
"@deepseek-ai/cordis": ">=4.0.5",
"@deepseek-ai/dsh-workspace": ">=0.2.1-rc.5",
"@deepseek-ai/dsh-client-connection": ">=0.2.1-rc.5"
```

The previous release (0.3.0) pinned `@deepseek-ai/dsh-workspace` and `@deepseek-ai/dsh-client-connection` to the exact `0.2.1-rc.5` and `@deepseek-ai/cordis` to `4.0.5`. On DSH 0.2.2 the host reads those peers (no `engines.dsh` was declared) and refuses to install — a hard gate block, not a theory. That is what 0.4.0 fixes.

## The two host APIs

**Server half** — `@deepseek-ai/dsh-workspace`'s `workspaceRegistry`:

| Used | Contract | Failure mode if the host moves it |
| --- | --- | --- |
| `workspaceRegistry.list()` | returns the durable display order | route answers `501` with `当前 DSH 版本没有工作区注册表…` |
| `workspaceRegistry.insertBefore(id, beforeId)` | one durable reorder, same write as a sidebar drag | route answers `501` (`…不支持调整工作区顺序…`) |
| `connection.fetch.register({ path, methods, requestBody, fetch })` | registers `POST /api/plugins/dsh-move-up/move` | registration is skipped with a console warning; the plugin still activates |

The registry write is also wrapped: a rejecting durable write becomes `write-failed` (HTTP 500) with the host's own message, and the order is left untouched.

**Client half** — two backends, chosen at runtime:

| Order | API | Available since | If unavailable |
| --- | --- | --- | --- |
| 1 | `ctx.contextMenus.register({ target: 'workspace' })` — the same public client capability the built-in Rename/Delete workspace actions use: data only (`label`, `failureLabel`, `run`), host renders the row | DSH ≥ 0.2.2: inspected `@deepseek-ai/dsh-client-ui-workspace@0.2.2-rc.1/0.2.2-rc.3` — their `client.js` exposes `contextMenus.register(` plus the `workspace` and `session` targets; `0.2.1-rc.5` does not | falls through |
| 2 | DOM decoration of the rendered workspace `…` menu: `[role="menu"]` + `button[role="menuitem"]`, workspace row captured from `[data-row-key^="workspace:"]`; no longer requires `data-menu-material`; skips a menu that already holds the legacy `data-wshub-move-top` row | all 0.2.x | the menu row is simply absent; nothing else breaks |

Neither backend reorders anything by itself. Every click ends in one `insertBefore` on the host.

## Verified matrix

`npm run compat:matrix` installs the real host packages for each version into a throwaway directory, copies the built plugin into it and re-runs `test/composition.test.mjs` there. The JSON evidence lands in `reports/compat-<date>.json`.

<!-- MATRIX:START -->
### 1. The host's own gate

The host's real evaluator (`@deepseek-ai/dsh-app-boot` → `evaluatePluginCompatibility`) run against both manifests, with the runtime version forced to each host:

| Plugin | 0.2.1-rc.5 | 0.2.2-rc.1 | 0.2.2-rc.2 | 0.2.2-rc.3 | 0.2.3 | 0.3.0 |
| --- | --- | --- | --- | --- | --- | --- |
| `dsh-move-up@0.4.0` | accepted | accepted | accepted | accepted | accepted | accepted |
| `dsh-move-up@0.3.0` (previous) | accepted | **blocked** | **blocked** | **blocked** | **blocked** | **blocked** |

That row is the bug this release fixes: the published 0.3.0 could not be installed on any DSH 0.2.2+, including the desktop build in use when 0.4.0 was written.

### 2. Real host packages

`npm run compat:matrix` installs the real `@deepseek-ai/*` packages per host version into a throwaway directory, copies the built plugin in and re-runs `test/composition.test.mjs` there:

| host | cordis | declared | install | composition tests | structured menu | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 0.2.1-rc.5 | 4.0.5 | satisfied | ok (43 s cold) | **8/8** | absent in that host bundle → fallback | **PASS** |
| 0.2.2-rc.1 | 4.1.0 | satisfied | ok | **8/8** | present | **PASS** |
| 0.2.2-rc.3 | 4.1.0 | satisfied | ok | **8/8** | present | **PASS** |

Run `node scripts/compat-matrix.mjs` (69.7 s on this machine, exit 0). The committed evidence is [`reports/compat-2026-11-17.json`](reports/compat-2026-11-17.json); `--json` prints the same report to stdout. The script re-reads each installed host package's version, refuses a stale `lib/` (mtime of `src/` vs `lib/`), and fails on anything other than HTTP 200/404 from the registry instead of guessing.
<!-- MATRIX:END -->

What the matrix does **not** do: it does not click through the desktop GUI. It proves the host contract, the plugin's activation and the durable reorder against real host packages; a human installing it in the desktop app is what closes the loop.

## Upgrade runbook (when a new DSH version ships)

```sh
# 1. See what the registry published
curl -sS https://registry.npmjs.org/@deepseek-ai%2fdsh-workspace -o /tmp/ws.json && \
  node -e 'console.log(Object.keys(require("/tmp/ws.json").versions).slice(-8).join(" "))'

# 2. Run the same suite against the new host version (and the old ones)
npm run compat:matrix -- --hosts 0.2.1-rc.5,0.2.2-rc.3,<new>

# 3. If a backend moved, the report names the failing host and the step.
#    The declaration needs no change (lower bound only). Fix code if needed,
#    bump the patch version, publish, and update this file with the new row.
```

If the structured backend disappears in a future host, the DOM fallback still ships. If both disappear, the menu row is absent and the server route still answers — a missing feature, never a broken host.

## Known limits

- Verified on macOS (Apple Silicon) desktop builds. Windows and Linux desktop builds have not been exercised.
- The DOM fallback depends on the sidebar markup. It is tolerant, but a host that renames every attribute would leave only the structured backend.
- A menu shows the action even when the workspace is already first; the server then answers `moved: false` and the UI reports “already at the top” instead of writing.
- Do not run this plugin next to `dsh-plugin-workspace-move-top` or `dsh-plugin-workspace-favorites`: both add the same row under a different attribute, so the menu would show the action twice.
