#!/usr/bin/env node
// Build the legacy-name compatibility release of Move Up.
//
// Why this exists: before this repository, the same feature shipped as
// `dsh-plugin-workspace-move-top` (0.2.2). People who installed that name keep
// upgrading it; publishing the fixed implementation under that name gives them
// the structured-menu backend and the DSH-upgrade resilience without asking
// them to change package names first. `dsh-move-up` stays the canonical name
// (repository, Discover index, docs) — this is a generated mirror, not a fork.
//
// The mirror needs its own identity so both packages can coexist without
// colliding: package name, cordis row id, service name, route path, context-menu
// provider id and DOM markers are all rewritten. The two client bundles
// cross-detect each other's marker, so a machine that ends up with both never
// renders two identical menu rows.
//
// Usage:
//   node scripts/build-mirror.mjs                 # generate + typecheck + build + test
//   node scripts/build-mirror.mjs --pack          # also npm pack the tarball
//   node scripts/build-mirror.mjs --publish       # publish (needs npm auth)
//
// Output: dist-mirror/ (gitignored). Bare-specifier imports resolve through the
// repository's own node_modules because the directory lives inside the repo.

import { mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
const OUT = join(REPO, 'dist-mirror')
const MIRROR_NAME = 'dsh-plugin-workspace-move-top'
const MIRROR_VERSION = '0.2.6'
const REGISTRY = 'https://registry.npmjs.org'

const args = new Set(process.argv.slice(2))
const source = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
if (source.name !== 'dsh-move-up') {
  throw new Error(`refusing to mirror from unexpected package ${source.name}`)
}

// 1. Start clean.
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// 2. Copy the pieces that make up the package.
for (const entry of ['src', 'client', 'test', 'cordis.patch.yml', 'dsh-plugin.naming.json', 'tsconfig.json', 'LICENSE', 'CHANGELOG.md', 'COMPATIBILITY.md']) {
  cpSync(join(REPO, entry), join(OUT, entry), { recursive: true })
}

/** Rewrite the identity of one text file. The two DOM markers are swapped, and
 * `data-move-up`/`data-wshub-move-top` must not be rewritten twice, hence the
 * placeholder dance. */
function mirrorText(text) {
  return text
    .replaceAll('dsh-move-up', MIRROR_NAME)
    .replaceAll('moveUpWorkspace', 'workspaceMoveTopWorkspace')
    .replaceAll("move-up:workspace", 'workspace.move-top')
    .replaceAll('workspace.move-up', 'workspace.move-top')
    .replaceAll("export const name = 'move-up'", `export const name = '${MIRROR_NAME}'`)
    .replaceAll('data-move-up', '__MIRROR_OWN_MARKER__')
    .replaceAll('data-wshub-move-top', 'data-move-up')
    .replaceAll('__MIRROR_OWN_MARKER__', 'data-wshub-move-top')
}

function writeMirrored(relative) {
  const target = join(OUT, relative)
  const text = readFileSync(target, 'utf8')
  const next = mirrorText(text)
  if (next !== text) writeFileSync(target, next)
}

for (const file of ['client/client.js', 'cordis.patch.yml', 'src/index.ts', 'src/service.ts', 'src/move-route.ts', 'test/composition.test.mjs', 'test/client.test.mjs']) {
  if (!existsSync(join(OUT, file))) throw new Error(`mirror source missing: ${file}`)
  writeMirrored(file)
}

// 2b. The naming manifest carries three identities, not one: the package name,
// the plugin short name and the coordinate. All three follow the legacy name.
const namingPath = join(OUT, 'dsh-plugin.naming.json')
const naming = JSON.parse(mirrorText(readFileSync(namingPath, 'utf8')))
naming.plugin.name = 'workspace-move-top'
naming.plugin.coordinate = 'dongsheng123132/workspace-move-top'
naming.names.pluginNames = ['workspace-move-top']
writeFileSync(namingPath, `${JSON.stringify(naming, null, 2)}\n`)

// 3. Package manifest: same engines/peers/tooling, legacy name and version.
const manifest = {
  ...source,
  name: MIRROR_NAME,
  version: MIRROR_VERSION,
  description: `Compatibility build of Move Up under its original package name: move a workspace to the top of the DeepSeek Harness sidebar once, through the host workspace registry. No favorites, pins, stars, or automatic reordering. No runtime dependencies, no saved state.`,
  repository: { type: 'git', url: 'git+https://github.com/dongsheng123132/dsh-move-up.git' },
  homepage: 'https://github.com/dongsheng123132/dsh-move-up',
  bugs: { url: 'https://github.com/dongsheng123132/dsh-move-up/issues' },
  keywords: ['dsh-plugin', 'deepseek-harness', 'dsh', 'workspace', 'move-top', 'ordering', 'compatibility'],
  files: ['lib/', 'client/', 'cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'COMPATIBILITY.md', 'CHANGELOG.md', 'dsh-plugin.naming.json'],
}
delete manifest.scripts['compat:matrix']
writeFileSync(join(OUT, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

// 4. Own README: short, honest about being generated, and points at the canonical package.
const install = `dsh plugin --profile <profile> add ${MIRROR_NAME}@${MIRROR_VERSION}`
writeFileSync(join(OUT, 'README.md'), `# Move Up (legacy package name · ${MIRROR_NAME})

[中文说明](README.zh-CN.md) · [Compatibility](COMPATIBILITY.md) · [Changelog](CHANGELOG.md)

This is the **compatibility build** of [Move Up](https://github.com/dongsheng123132/dsh-move-up) published under the package name this feature had before it got its own repository. The implementation is generated from the canonical repository; the canonical package is \`dsh-move-up\`.

Adds **Move to top** to a DeepSeek Harness workspace's \`…\` menu: one click performs one reorder through the host's own \`workspaceRegistry.insertBefore\` — no favorites, no pins, no startup re-sorting, no saved state.

## Install

\`\`\`text
${MIRROR_NAME}@${MIRROR_VERSION}
\`\`\`

Or, for a CLI-managed profile:

\`\`\`sh
${install}
\`\`\`

Already on \`dsh-move-up\`? Keep using it — this build and \`dsh-move-up\` are the same feature under two package names. Do not install both at once: the two client bundles detect each other and the second one stays out of the menu, but there is no reason to carry both.

## Compatibility

Same declaration as the canonical package: \`engines.dsh: ">=0.2.1-rc.5"\` (lower bound only) and the same two client backends — the host's structured context-menu API where it exists, a tolerant DOM fallback elsewhere. See [COMPATIBILITY.md](COMPATIBILITY.md) and [CHANGELOG.md](CHANGELOG.md).

## Verify

\`\`\`sh
npm ci
npm run check
\`\`\`

## License

MIT
`)
writeFileSync(join(OUT, 'README.zh-CN.md'), `# Move Up · 移到最上面（旧包名 · ${MIRROR_NAME}）

[English](README.md) · [兼容性](COMPATIBILITY.md) · [更新日志](CHANGELOG.md)

这是 [Move Up](https://github.com/dongsheng123132/dsh-move-up) 的**兼容构建**：用这个功能拥有独立仓库之前的旧包名发布，代码由主仓库生成，主包名是 \`dsh-move-up\`。

在 DSH 工作区 \`…\` 菜单里加一项「移到最上面」：点一次，通过宿主自己的 \`workspaceRegistry.insertBefore\` 完成一次排序 —— 没有收藏、置顶、启动重排，不存状态。

## 安装

\`\`\`text
${MIRROR_NAME}@${MIRROR_VERSION}
\`\`\`

## 兼容性

与主包同一声明：\`engines.dsh: ">=0.2.1-rc.5"\`（只有下界），同样两条客户端后端（结构化菜单优先，DOM 回退兜底）。详见 [COMPATIBILITY.md](COMPATIBILITY.md)。

已经装了 \`dsh-move-up\` 的不用换；两个包是同一功能，别同时装。

## 许可证

MIT
`)

// 5. Build + test in place. Bare imports resolve through the repository node_modules.
const npmCache = process.env.npm_config_cache || join(REPO, '.npm-cache-mirror')
const env = { ...process.env, npm_config_cache: npmCache, npm_config_registry: REGISTRY }
function run(command, argv, options = {}) {
  process.stdout.write(`\n$ ${command} ${argv.join(' ')}\n`)
  execFileSync(command, argv, { cwd: OUT, stdio: 'inherit', env, ...options })
}

run(process.execPath, [join(REPO, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'])
run(process.execPath, ['--test', 'test/composition.test.mjs'])
run(process.execPath, ['--test', 'test/client.test.mjs'])

if (args.has('--pack') || args.has('--publish')) {
  run('npm', ['pack', '--registry', REGISTRY])
}
if (args.has('--publish')) {
  const latest = execFileSync('npm', ['view', MIRROR_NAME, 'dist-tags.latest', '--json', '--registry', REGISTRY], { cwd: OUT, env, encoding: 'utf8' }).trim()
  process.stdout.write(`\ncurrent ${MIRROR_NAME} latest: ${latest}\n`)
  run('npm', ['publish', '--registry', REGISTRY])
}

process.stdout.write(`\nmirror ready: ${OUT} (${MIRROR_NAME}@${MIRROR_VERSION})\n`)
