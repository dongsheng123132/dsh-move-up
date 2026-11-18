#!/usr/bin/env node
// Does the built plugin still load and reorder correctly on each published DSH
// host version? Installs the real @deepseek-ai packages for one version into a
// throwaway tree, copies the built plugin plus its composition test in, and runs
// that test there. Prints a table; exits nonzero if any host fails.
//
//   node scripts/compat.mjs                        # default hosts
//   node scripts/compat.mjs --hosts 0.2.1-rc.5,0.2.2-rc.3
//   node scripts/compat.mjs --json
//
// Only the range form this package declares (`>=x.y.z`) is evaluated here; the
// authoritative check stays the host itself (dsh-app-boot). Registry access is a
// plain fetch: 200 = published, 404 = unpublished, anything else is an error.

import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const REGISTRY = 'https://registry.npmjs.org'
const DEFAULT_HOSTS = ['0.2.1-rc.5', '0.2.2-rc.1', '0.2.2-rc.3']
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : args[at + 1]
}
const HOSTS = String(flag('hosts', DEFAULT_HOSTS.join(','))).split(',').map(s => s.trim()).filter(Boolean)
const JSON_ONLY = args.includes('--json')
const log = (...values) => { if (!JSON_ONLY) process.stderr.write(values.join(' ') + '\n') }

const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
// These follow the host version. cordis has its own line (4.0.5 / 4.1.0), so its
// concrete version is resolved from the host package's peer range instead.
const hostPackages = ['@deepseek-ai/dsh-workspace', '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-workspace']

/** `>=0.2.1-rc.5` → true for every version at or above it (prerelease aware). */
function satisfiesFloor(version, range) {
  const match = /^>=\s*(.+)$/.exec(String(range).trim())
  if (!match) return null
  const parse = raw => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(raw.trim())
    return m && { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] }
  }
  const a = parse(version)
  const b = parse(match[1])
  if (!a || !b) return null
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i]
  if (!a.pre.length || !b.pre.length) return !a.pre.length // release >= prerelease
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i]
    if (x === undefined) return false
    if (y === undefined) return true
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
    if (nx && ny && +x !== +y) return +x > +y
    if (nx !== ny) return nx
    if (x !== y) return x > y
  }
  return true
}

/** Resolve the concrete cordis version a host version asks for. */
async function cordisFor(host) {
  const workspace = await (await fetch(`${REGISTRY}/@deepseek-ai%2Fdsh-workspace/${host}`)).json()
  const range = workspace.peerDependencies?.['@deepseek-ai/cordis']
  if (!range) throw new Error(`@deepseek-ai/dsh-workspace@${host} declares no cordis peer`)
  const all = Object.keys((await (await fetch(`${REGISTRY}/@deepseek-ai%2Fcordis`)).json()).versions || {})
  const exact = all.find(v => v === range)
  if (exact) return exact
  const marker = /^[~^]/.exec(range)
  const prefix = marker ? marker[0] : null
  const base = prefix ? range.slice(1).split('.').slice(0, prefix === '~' ? 2 : 1).join('.') : null
  const candidates = all.filter(v => !v.includes('-') && (prefix === '~' ? v.startsWith(base + '.') : v.split('.')[0] === base))
  if (!candidates.length) throw new Error(`no published cordis version matches ${range} (host ${host})`)
  const numeric = v => v.split('.').map(Number)
  candidates.sort((a, b) => { const x = numeric(a), y = numeric(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 })
  return candidates[candidates.length - 1]
}

async function published(name, version) {
  const url = `${REGISTRY}/${name.replace('/', '%2F')}/${version}`
  const response = await fetch(url)
  if (response.status === 200) return true
  if (response.status === 404) return false
  throw new Error(`${name}@${version}: registry answered HTTP ${response.status}`)
}

function npm(argv, cwd, cache) {
  execFileSync('npm', argv, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, npm_config_cache: cache, npm_config_registry: REGISTRY },
  })
}

/** Does this host bundle carry the structured context-menu API? */
function hasStructuredMenu(tree, host) {
  const file = join(tree, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js')
  if (!existsSync(file)) return null
  const source = readFileSync(file, 'utf8')
  return /contextMenus\.register\(/.test(source) && /target:\s*[`"']workspace[`"']/.test(source)
}

async function runHost(host, cache) {
  const record = { host, declared: satisfiesFloor(host, pkg.engines?.dsh ?? ''), install: false, tests: null, structuredMenu: null, verdict: 'fail' }
  for (const name of hostPackages) {
    if (!(await published(name, host))) throw new Error(`required host package unavailable: ${name}@${host} (HTTP 404)`)
  }
  const cordis = await cordisFor(host)
  record.cordis = cordis
  const plugins = [['@deepseek-ai/cordis', cordis], ...hostPackages.map(name => [name, host])]
  const tree = mkdtempSync(join(tmpdir(), `dsh-compat-${host}-`))
  try {
    for (const entry of ['lib', 'client', 'test']) cpSync(join(REPO, entry), join(tree, entry), { recursive: true })
    writeFileSync(join(tree, 'package.json'), JSON.stringify({
      ...pkg,
      private: true,
      peerDependencies: Object.fromEntries(plugins),
      devDependencies: {},
      scripts: {},
    }, null, 2))
    log(`  installing ${host} …`)
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', '--registry', REGISTRY, ...plugins.map(([name, version]) => `${name}@${version}`)], tree, cache)
    record.install = true
    record.structuredMenu = hasStructuredMenu(tree, host)
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'test/composition.test.mjs'], { cwd: tree, encoding: 'utf8' })
    record.tests = output.match(/# pass (\d+)/)?.[1] ? Number(output.match(/# pass (\d+)/)[1]) : null
    record.failed = Number(output.match(/# fail (\d+)/)?.[1] ?? 0)
    record.verdict = record.failed === 0 && record.tests ? 'pass' : 'fail'
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
  return record
}

const cache = mkdtempSync(join(tmpdir(), 'dsh-compat-cache-'))
const results = []
try {
  for (const host of HOSTS) {
    log(`\n▶ ${host}`)
    try {
      results.push(await runHost(host, cache))
    } catch (error) {
      results.push({ host, declared: satisfiesFloor(host, pkg.engines?.dsh ?? ''), install: false, verdict: 'fail', error: String(error.message) })
    }
  }
} finally {
  rmSync(cache, { recursive: true, force: true })
}

if (JSON_ONLY) {
  process.stdout.write(JSON.stringify({ plugin: `${pkg.name}@${pkg.version}`, declared: pkg.engines?.dsh, hosts: results }, null, 2) + '\n')
} else {
  const cell = value => String(value).padEnd(12)
  process.stdout.write(`\n${cell('host')}${cell('cordis')}${cell('declared')}${cell('install')}${cell('tests')}${cell('menu')}verdict\n`)
  for (const r of results) {
    process.stdout.write(`${cell(r.host)}${cell(r.cordis ?? '-')}${cell(r.declared)}${cell(r.install)}${cell(r.tests ?? '-')}${cell(r.structuredMenu === null ? '?' : r.structuredMenu ? 'structured' : 'dom')}${r.verdict}${r.error ? '  ' + r.error : ''}\n`)
  }
}
process.exitCode = results.every(r => r.verdict === 'pass' && r.declared !== false) ? 0 : 1
