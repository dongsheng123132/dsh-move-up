# Move to Top

[中文说明](README.zh-CN.md)

Add **Move to top** to a DSH workspace's `…` menu. One click performs one reorder through the host's official `workspaceRegistry.insertBefore` API, just like a long manual drag.

- One action only: no stars, favorites, pinned categories, or automatic reordering.
- 7 KB npm package, no runtime dependencies, no saved state, no background work. If you never click it, nothing happens.
- Manual dragging remains yours; activation and synchronization never restore an old order.

## Install

```sh
dsh plugin --profile desktop add dsh-move-up@0.2.1
```

## Add it to DSH Discover (optional)

DSH 0.2.2 ships an experimental plugin market with a Discover tab. It has no official catalog; Discover lists only the index sources a user adds. This repository is one:

```text
https://raw.githubusercontent.com/dongsheng123132/dsh-move-up/main/plugin-index.json
```

Open **Plugins → Discover → Add index source**, paste the URL, then search for `move-top`. Installing from Discover still goes through the normal plugin confirmation and npm.

## Compatibility and limits

Tested with **DSH 0.2.1-rc.5 on macOS**. This release targets that exact host version. Menu copy follows the browser language: Chinese or English.

The host has no workspace-menu extension slot, so the client uses the current workspace-row and menu DOM. If a future host changes that structure, the action may disappear. It must not reorder workspaces on its own. Windows and non-empty session-menu browser behavior have not been verified.

## Verify

```sh
npm ci
npm run check
```

## License

MIT
