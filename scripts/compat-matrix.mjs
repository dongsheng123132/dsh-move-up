#!/usr/bin/env node
/**
 * compat-matrix.mjs — prove this plugin really works against several PUBLISHED
 * DeepSeek Harness host versions.
 *
 * For every target host version it:
 *   1. evaluates the plugin's DECLARED DSH compatibility with the host's real rule
 *      (engines.dsh, else every @deepseek-ai/dsh / @deepseek-ai/dsh-* peer range);
 *   2. builds a throwaway npm project holding the plugin's lib/, client/, the real
 *      composition test and a package.json pinned to that host, installs the real
 *      host packages from npm (writable temp npm cache), then runs
 *      `node --test test/composition.test.mjs` inside it;
 *   3. inspects the host's published client bundle for the structured context-menu
 *      API the plugin's UI path needs (contextMenus.register + workspace/session
 *      targets);
 *   4. prints a human table plus a machine-readable JSON report in reports/.
 *
 * Exit code 0 only when every host installs, every composition test passes, and
 * every host the plugin DECLARES compatibility with is actually satisfied.
 *
 * Zero new dependencies: semver is loaded from npm's own bundled copy.
 *
 * Usage:
 *   node scripts/compat-matrix.mjs
 *   node scripts/compat-matrix.mjs --hosts 0.2.1-rc.5,0.2.2-rc.1 --keep
 *   node scripts/compat-matrix.mjs --json > /tmp/matrix.json
 *   node scripts/compat-matrix.mjs --self          # also once: npm run check
 *
 * Flags:
 *   --hosts <a,b,c>  host versions (default 0.2.1-rc.5,0.2.2-rc.1,0.2.2-rc.3)
 *   --repo <path>    repo root (default: the repo containing this script)
 *   --keep           keep temp dirs (prints their path)
 *   --json            stdout is the JSON report only (progress goes to stderr)
 *   --self           also run the repo's own `npm run check` once (writes lib/)
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

// ────────────────────────────────────────────────────────────────────────────
// constants
// ────────────────────────────────────────────────────────────────────────────

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SCRIPT_DIR = path.dirname(SCRIPT_PATH)
const DEFAULT_REPO = path.resolve(SCRIPT_DIR, '..')
const DEFAULT_HOSTS = ['0.2.1-rc.5', '0.2.2-rc.1', '0.2.2-rc.3']

const REGISTRY = 'https://registry.npmjs.org'
const INSTALL_TIMEOUT_MS = 240_000
const TEST_TIMEOUT_MS = 120_000
const REGISTRY_TIMEOUT_MS = 60_000 // plain-HTTP registry lookups
const REGISTRY_RETRIES = 2 // retries for network errors / 5xx / 429 only
const SELF_TIMEOUT_MS = 600_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const STDERR_TAIL_LINES = 40
const MAX_CAPTURED_BYTES = 512 * 1024

/** Host packages: peers of the plugin (and the UI package that owns the
 * structured context-menu API). `optional` packages may legitimately be
 * unpublished for a given host version. */
const HOST_PACKAGES = [
  { name: '@deepseek-ai/dsh-workspace', optional: false },
  { name: '@deepseek-ai/dsh-client-connection', optional: false },
  { name: '@deepseek-ai/dsh-client-ui-workspace', optional: true },
]
const UI_PACKAGE = '@deepseek-ai/dsh-client-ui-workspace'

/** Files/dirs copied into each temp host project. */
const COPY_DIRS = ['lib', 'client']
const COPY_FILES = ['tsconfig.json']
const TEST_FILE = 'test/composition.test.mjs'

// ────────────────────────────────────────────────────────────────────────────
// small utilities
// ────────────────────────────────────────────────────────────────────────────

const t0 = Date.now()
const log = (msg) => { if (!OPTIONS.json) process.stdout.write(`${msg}\n`) }
const progress = (msg) => process.stderr.write(`${msg}\n`)
const elapsed = () => Date.now() - t0

function tailLines(text, n = STDERR_TAIL_LINES) {
  if (!text) return []
  const lines = String(text).replace(/\r\n/g, '\n').trimEnd().split('\n')
  return lines.slice(-n)
}

function clip(buf) {
  const s = String(buf ?? '')
  return s.length > MAX_CAPTURED_BYTES ? s.slice(-MAX_CAPTURED_BYTES) : s
}

/** Spawn a child process, capture bounded stdout/stderr, enforce a timeout. */
function run(command, args, { cwd, env, timeoutMs = TEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ command, args, cwd, code: null, signal: null, timedOut: false, stdout: '', stderr: String(error?.message ?? error), durationMs: 0 })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout = clip(stdout + chunk.toString()) })
    child.stderr.on('data', (chunk) => { stderr = clip(stderr + chunk.toString()) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ command, args, cwd, code: null, signal: null, timedOut, stdout, stderr: clip(`${stderr}\nspawn error: ${error?.message ?? error}`), durationMs: Date.now() - started })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ command, args, cwd, code, signal, timedOut, stdout, stderr, durationMs: Date.now() - started })
    })
  })
}

const shellish = (command, args) => [command, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')

/** Load semver from npm's own bundled copy — never hand-roll the comparator. */
function loadSemver() {
  const candidates = []
  const attempt = (from, label) => {
    try {
      return createRequire(from)('semver')
    } catch (error) {
      candidates.push(`${label}: ${error?.code ?? error?.message ?? error}`)
      return null
    }
  }
  // 1) resolvable from this script / repo, 2) npm's bundled copy next to the npm
  // binary that will run our installs (npm root -g / npm/node_modules/semver).
  for (const [from, label] of [
    [import.meta.url, 'script'],
    [path.join(OPTIONS.repo, 'package.json'), 'repo'],
  ]) {
    const found = attempt(from, label)
    if (found) return found
  }
  const guessRoots = [
    process.env.npm_config_prefix,
    ...(process.execPath.includes('/Cellar/node') ? [] : []),
    '/opt/homebrew/lib/node_modules',
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
  ].filter(Boolean)
  const npmRoots = [...new Set(guessRoots)]
  for (const root of npmRoots) {
    const p = path.join(root, 'npm', 'node_modules', 'semver')
    if (!existsSync(p)) continue
    const found = attempt(path.join(root, 'npm', 'package.json'), p)
    if (found) return found
  }
  throw new Error(
    'could not load the `semver` package from npm\'s own installation (no hand-rolled comparator allowed).\n' +
      `tried: ${candidates.join(' | ')} | looked for <global-npm-root>/npm/node_modules/semver in: ${npmRoots.join(', ')}\n` +
      'fix: make sure `npm` is installed globally (it ships semver) or install semver where this repo can resolve it.',
  )
}

// ────────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────────

const OPTIONS = { hosts: DEFAULT_HOSTS, repo: DEFAULT_REPO, keep: false, json: false, self: false }

function parseArgs(argv) {
  const hosts = []
  let hostsGiven = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = (name) => {
      const inline = arg.split(/=(.*)/s)
      if (inline.length > 1) return inline[1]
      const next = argv[++i]
      if (next === undefined) throw new Error(`${name} requires a value`)
      return next
    }
    if (arg === '--keep') OPTIONS.keep = true
    else if (arg === '--json') OPTIONS.json = true
    else if (arg === '--self') OPTIONS.self = true
    else if (arg === '--help' || arg === '-h') { printUsage(); process.exit(0) }
    else if (arg.startsWith('--hosts')) { hostsGiven = true; hosts.push(...value('--hosts').split(',')) }
    else if (arg.startsWith('--repo')) OPTIONS.repo = path.resolve(value('--repo'))
    else throw new Error(`unknown flag: ${arg}`)
  }
  if (hostsGiven) {
    const cleaned = hosts.map((h) => h.trim()).filter(Boolean)
    if (!cleaned.length) throw new Error('--hosts was empty')
    OPTIONS.hosts = [...new Set(cleaned)]
  }
  OPTIONS.repo = path.resolve(OPTIONS.repo)
}

function printUsage() {
  process.stdout.write(`compat-matrix — prove a DSH plugin against published host versions

usage: node scripts/compat-matrix.mjs [flags]

  --hosts <a,b,c>  host versions to test (default ${DEFAULT_HOSTS.join(',')})
  --repo <path>    repo root (default: the repo containing this script)
  --keep           keep temp dirs
  --json           print the JSON report on stdout only
  --self           also run the repo's own \`npm run check\` once (writes lib/)
`)
}

// ────────────────────────────────────────────────────────────────────────────
// declared compatibility — mirrors the host's real rule
// ────────────────────────────────────────────────────────────────────────────

/**
 * Host rule for plugin DSH compatibility:
 *  - if `engines.dsh` exists, that range is the ONLY requirement;
 *  - otherwise every peerDependency named `@deepseek-ai/dsh` or starting with
 *    `@deepseek-ai/dsh-` is a requirement.
 */
function declaredRequirements(pkg) {
  const enginesDsh = pkg?.engines?.dsh
  if (typeof enginesDsh === 'string' && enginesDsh.trim()) {
    return { source: 'engines.dsh', requirements: [{ name: 'dsh', range: enginesDsh.trim(), field: 'engines.dsh' }] }
  }
  const requirements = []
  for (const [name, range] of Object.entries(pkg?.peerDependencies ?? {})) {
    if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
      requirements.push({ name, range: String(range), field: 'peerDependencies' })
    }
  }
  return { source: requirements.length ? 'peerDependencies' : 'none', requirements }
}

function evaluateDeclared(declaration, host, semver) {
  if (!declaration.requirements.length) {
    return { source: declaration.source, host, satisfied: null, requirements: [], reason: 'plugin declares no DSH compatibility range' }
  }
  const requirements = declaration.requirements.map((r) => ({
    ...r,
    satisfied: safeSatisfies(semver, host, r.range),
  }))
  const satisfied = requirements.every((r) => r.satisfied === true)
  return {
    source: declaration.source,
    host,
    satisfied,
    requirements,
    reason: satisfied
      ? null
      : requirements.filter((r) => r.satisfied !== true).map((r) => `${r.field}.${r.name} "${r.range}" does not accept ${host}`).join('; '),
  }
}

function safeSatisfies(semver, version, range) {
  try {
    return semver.satisfies(version, range, { includePrerelease: true })
  } catch {
    return false
  }
}

// ────────────────────────────────────────────────────────────────────────────
// registry metadata (with cache) + npm install with a writable cache
// ────────────────────────────────────────────────────────────────────────────

const state = { runRoot: null, cacheDir: null, semver: null }

function npmEnv(extra = {}) {
  return {
    npm_config_cache: state.cacheDir,
    npm_config_update_notifier: 'false',
    npm_config_loglevel: 'warn',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    CI: '1',
    ...extra,
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** `@scope/name` (+ optional version) → registry URL with the scope slash encoded. */
function registryUrl(name, version) {
  const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)
  return version ? `${REGISTRY}/${encoded}/${encodeURIComponent(version)}` : `${REGISTRY}/${encoded}`
}

/**
 * Plain-HTTP registry access — no npm subprocess, so a broken/spinning `npm view`
 * can never be mistaken for "this version does not exist".
 * Returns `{ status: 'ok', data }`, `{ status: 'not-found' }` (HTTP 404) or
 * `{ status: 'error', message }`. Only a real 404 means unpublished.
 */
async function fetchJson(url, { timeoutMs = REGISTRY_TIMEOUT_MS, accept = 'application/json' } = {}) {
  const attempts = []
  for (let attempt = 1; attempt <= REGISTRY_RETRIES + 1; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(timeoutMs) })
      const text = await response.text()
      if (response.status === 200) {
        try {
          return { status: 'ok', data: JSON.parse(text), url }
        } catch (error) {
          attempts.push(`attempt ${attempt}: unparseable JSON (${error?.message ?? error})`)
        }
      } else if (response.status === 404) {
        return { status: 'not-found', url }
      } else {
        attempts.push(`attempt ${attempt}: HTTP ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 300).replace(/\s+/g, ' ')}` : ''}`)
        // Only transient statuses are worth retrying.
        if (response.status < 500 && response.status !== 429) return { status: 'error', url, message: attempts.at(-1) }
      }
    } catch (error) {
      attempts.push(`attempt ${attempt}: ${error?.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : (error?.message ?? error)}`)
    }
    if (attempt <= REGISTRY_RETRIES) await sleep(300 * attempt)
  }
  return { status: 'error', url, message: attempts.join(' | ') }
}

/** One published version's manifest: `{ version, tarball, peerDependencies }`. */
async function registryManifest(name, version) {
  const result = await fetchJson(registryUrl(name, version))
  if (result.status !== 'ok') return result
  const data = result.data ?? {}
  return {
    status: 'ok',
    url: result.url,
    version: typeof data.version === 'string' ? data.version : undefined,
    tarball: typeof data.dist?.tarball === 'string' ? data.dist.tarball : undefined,
    peerDependencies: data.peerDependencies && typeof data.peerDependencies === 'object' ? data.peerDependencies : undefined,
  }
}

/** All published versions of a package (abbreviated packument). */
async function registryVersions(name) {
  const result = await fetchJson(registryUrl(name), { accept: 'application/vnd.npm.install-v1+json' })
  if (result.status !== 'ok') return result
  const versions = Object.keys(result.data?.versions ?? {})
  return { status: 'ok', url: result.url, versions }
}

/** Download a tarball with the same retry/error discipline. */
async function fetchBytes(url, { timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  const attempts = []
  for (let attempt = 1; attempt <= REGISTRY_RETRIES + 1; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (response.status === 200) return { status: 'ok', bytes: Buffer.from(await response.arrayBuffer()) }
      attempts.push(`attempt ${attempt}: HTTP ${response.status} ${response.statusText}`)
      if (response.status < 500 && response.status !== 429) return { status: 'error', message: attempts.at(-1) }
    } catch (error) {
      attempts.push(`attempt ${attempt}: ${error?.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : (error?.message ?? error)}`)
    }
    if (attempt <= REGISTRY_RETRIES) await sleep(300 * attempt)
  }
  return { status: 'error', message: attempts.join(' | ') }
}

/** Highest published version satisfying `range`, preferring stable releases. */
function pickVersion(versions, range, semver) {
  const satisfying = versions.filter((v) => safeSatisfies(semver, v, range))
  const stable = satisfying.filter((v) => semver.prerelease(v) === null)
  const pool = stable.length ? stable : satisfying
  return pool.sort((a, b) => semver.rcompare(a, b))[0] ?? null
}

// ────────────────────────────────────────────────────────────────────────────
// per-host preparation
// ────────────────────────────────────────────────────────────────────────────

async function readRepoPackage(repo) {
  const file = path.join(repo, 'package.json')
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${file}: ${error?.message ?? error}`)
  }
  try {
    return { text, pkg: JSON.parse(text) }
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error?.message ?? error}`)
  }
}

async function resolveHostPackages(host) {
  const published = []
  const unavailable = []
  const errors = []
  const peerRanges = []
  for (const spec of HOST_PACKAGES) {
    const manifest = await registryManifest(spec.name, host)
    if (manifest.status === 'ok') {
      published.push(spec.name)
      const cordisPeer = manifest.peerDependencies?.['@deepseek-ai/cordis']
      if (typeof cordisPeer === 'string') peerRanges.push({ name: spec.name, range: cordisPeer })
      continue
    }
    if (manifest.status === 'not-found') {
      const reason = `${spec.name}@${host} is not published on ${REGISTRY} (registry HTTP 404)`
      if (spec.optional) { unavailable.push({ name: spec.name, status: 'not-published', reason, url: manifest.url }); continue }
      throw new Error(`required host package unavailable: ${reason}`)
    }
    // A network/HTTP problem is NOT "unpublished" — surface it instead of hiding it.
    const reason = `registry lookup for ${spec.name}@${host} failed: ${manifest.message} (${manifest.url})`
    errors.push({ name: spec.name, reason, url: manifest.url })
    if (!spec.optional) throw new Error(reason)
  }
  return { published, unavailable, errors, peerRanges }
}

async function chooseCordis(host, peerRanges) {
  const listed = await registryVersions('@deepseek-ai/cordis')
  if (listed.status !== 'ok') {
    throw new Error(
      listed.status === 'not-found'
        ? `@deepseek-ai/cordis is not published on ${REGISTRY}`
        : `cannot list @deepseek-ai/cordis versions: ${listed.message} (${listed.url})`,
    )
  }
  const versions = listed.versions
  if (!versions.length) throw new Error(`registry returned no @deepseek-ai/cordis versions from ${listed.url}`)
  const byPackage = peerRanges.map((p) => ({ ...p, version: pickVersion(versions, p.range, state.semver) }))
  const all = [...new Set(byPackage.map((p) => p.version).filter(Boolean))]
  if (all.length === 1) return { cordis: all[0], ranges: byPackage, conflict: null }
  if (!all.length) {
    return { cordis: null, ranges: byPackage, conflict: `no published @deepseek-ai/cordis version satisfies ${peerRanges.map((p) => `${p.name} ${p.range}`).join(' + ')}` }
  }
  // Different picks: intersect all ranges for one shared cordis version.
  const shared = versions.filter((v) => peerRanges.every((p) => safeSatisfies(state.semver, v, p.range)))
  const sharedStable = shared.filter((v) => state.semver.prerelease(v) === null)
  const best = (sharedStable.length ? sharedStable : shared).sort((a, b) => state.semver.rcompare(a, b))[0]
  if (best) return { cordis: best, ranges: byPackage, conflict: null }
  return { cordis: null, ranges: byPackage, conflict: `host packages disagree on @deepseek-ai/cordis: ${peerRanges.map((p) => `${p.name} peer ${p.range}`).join(' + ')}` }
}

/** Copy the plugin into a temp dir and rewrite package.json for this host. */
async function prepareHostProject(host, { repoPackage, cordis }) {
  const dir = path.join(state.runRoot, `host-${host.replace(/[^\w.-]/g, '_')}`)
  await mkdir(path.join(dir, 'test'), { recursive: true })

  for (const sub of COPY_DIRS) {
    const from = path.join(OPTIONS.repo, sub)
    if (existsSync(from)) await cp(from, path.join(dir, sub), { recursive: true })
  }
  for (const file of COPY_FILES) {
    const from = path.join(OPTIONS.repo, file)
    if (existsSync(from)) await cp(from, path.join(dir, file))
  }
  await cp(path.join(OPTIONS.repo, TEST_FILE), path.join(dir, TEST_FILE))

  const rewritten = JSON.parse(repoPackage.text)
  await writeFile(path.join(dir, 'package.original.json'), repoPackage.text) // keep a copy of the original

  // Point every host-package peer/dev entry at exactly this host version.
  const pinnedFor = (name) => (name === '@deepseek-ai/cordis' ? cordis : host)
  const isHostPackage = (name) => name === '@deepseek-ai/cordis' || name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
  const rewriteHostEntries = (entries) => {
    const out = {}
    for (const name of Object.keys(entries ?? {})) if (isHostPackage(name)) out[name] = pinnedFor(name)
    return out
  }
  rewritten.peerDependencies = rewriteHostEntries(rewritten.peerDependencies)
  const devDeps = rewriteHostEntries(rewritten.devDependencies)
  // Drop tool-only devDeps (typescript, @types/node): the harness runs `node --test`
  // against the already-built lib/, it never typechecks or builds.
  if (Object.keys(devDeps).length) rewritten.devDependencies = devDeps
  else delete rewritten.devDependencies
  // The host packages are installed explicitly on the npm command line, so a
  // throwaway project needs no dependency entry for them.
  if (!Object.keys(rewritten.dependencies ?? {}).length) delete rewritten.dependencies
  delete rewritten.scripts?.prepack
  delete rewritten.scripts?.pretest
  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify(rewritten, null, 2)}\n`)
  return dir
}

// ────────────────────────────────────────────────────────────────────────────
// structured context-menu probe (published UI bundle)
// ────────────────────────────────────────────────────────────────────────────

/** Minimal ustar reader: return the bytes of one file inside a .tgz. */
function extractTarEntry(tgz, wantedSuffix) {
  let tar
  try {
    tar = gunzipSync(tgz)
  } catch (error) {
    throw new Error(`tarball is not valid gzip: ${error?.message ?? error}`)
  }
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break // end-of-archive marker
    const read = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '').trim()
    const name = read(0, 100)
    const prefix = read(345, 500)
    const size = parseInt(read(124, 136), 8) || 0
    const type = String.fromCharCode(header[156])
    const fullPath = prefix ? `${prefix}/${name}` : name
    const dataStart = offset + 512
    if (type === '0' || type === '\0') {
      if (fullPath === wantedSuffix || fullPath.endsWith(`/${wantedSuffix}`)) return tar.subarray(dataStart, dataStart + size)
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return null
}

function collectMatches(source, regex, limit = 2, pad = 90) {
  const out = []
  const global = new RegExp(regex.source, `${regex.flags.includes('g') ? regex.flags : `${regex.flags}g`}`)
  let match
  while ((match = global.exec(source)) && out.length < limit) {
    const start = Math.max(0, match.index - pad)
    out.push(source.slice(start, Math.min(source.length, match.index + match[0].length + pad)).replace(/\s+/g, ' '))
    if (match[0].length === 0) global.lastIndex++
  }
  return out
}

async function probeStructuredMenu(host, hostPackages = {}) {
  const result = {
    available: null, // true | false | null (could not determine: registry/network error)
    status: 'unknown', // 'available' | 'missing-api' | 'not-published' | 'error'
    reason: null,
    package: UI_PACKAGE,
    version: host,
    method: 'plain-HTTP registry lookup + published tarball, inspect package/lib/client.js',
    tarball: null,
    clientBytes: 0,
    checks: {
      contextMenusRegister: false,
      workspaceTarget: false,
      sessionTarget: false,
      workspaceTargetLiteral: false,
      sessionTargetLiteral: false,
    },
    evidence: {},
    errors: [],
  }
  if (hostPackages.unavailable?.some((u) => u.name === UI_PACKAGE)) {
    result.status = 'not-published'
    result.reason = hostPackages.unavailable.find((u) => u.name === UI_PACKAGE).reason
    return result
  }
  const meta = await registryManifest(UI_PACKAGE, host)
  if (meta.status === 'not-found') {
    result.status = 'not-published'
    result.reason = `${UI_PACKAGE}@${host} is not published on ${REGISTRY} (registry HTTP 404)`
    return result
  }
  if (meta.status !== 'ok' || !meta.tarball) {
    result.status = 'error'
    result.reason = `${UI_PACKAGE}@${host}: registry lookup failed — ${meta.message ?? 'no dist.tarball'} (${meta.url})`
    return result
  }
  const url = meta.tarball
  result.tarball = url
  const download = await fetchBytes(url)
  if (download.status !== 'ok') {
    result.status = 'error'
    result.reason = `could not download ${url}: ${download.message}`
    return result
  }
  let source
  try {
    const entry = extractTarEntry(download.bytes, 'package/lib/client.js')
    if (!entry) {
      result.status = 'missing-api'
      result.reason = 'package/lib/client.js not found in the published tarball'
      return result
    }
    source = entry.toString('utf8')
  } catch (error) {
    result.status = 'error'
    result.reason = `could not read client bundle: ${error?.message ?? error}`
    return result
  }
  result.clientBytes = source.length
  const registerRe = /contextMenus\.register\(/g
  const workspaceRe = /target\s*:\s*(['"`])workspace\1/g
  const sessionRe = /target\s*:\s*(['"`])session\1/g
  result.checks.contextMenusRegister = registerRe.test(source)
  result.checks.workspaceTarget = workspaceRe.test(source)
  result.checks.sessionTarget = sessionRe.test(source)
  result.checks.workspaceTargetLiteral = source.includes('target: "workspace"')
  result.checks.sessionTargetLiteral = source.includes('target: "session"')
  result.evidence = {
    contextMenusRegister: collectMatches(source, /contextMenus\.register\(/, 1),
    workspaceTarget: collectMatches(source, workspaceRe, 1),
    sessionTarget: collectMatches(source, sessionRe, 1),
  }
  const missing = []
  if (!result.checks.contextMenusRegister) missing.push('contextMenus.register(')
  if (!result.checks.workspaceTarget) missing.push('target: "workspace"')
  if (!result.checks.sessionTarget) missing.push('target: "session"')
  result.available = missing.length === 0
  result.status = result.available ? 'available' : 'missing-api'
  result.reason = result.available ? null : `${UI_PACKAGE}@${host}/lib/client.js lacks ${missing.join(', ')}`
  return result
}

// ────────────────────────────────────────────────────────────────────────────
// per-host run
// ────────────────────────────────────────────────────────────────────────────

function parseTap(stdout) {
  const counts = { tests: null, pass: null, fail: null, skipped: null, todo: null, cancelled: null }
  for (const match of stdout.matchAll(/^#\s+(tests|pass|fail|skipped|todo|cancelled)\s+(\d+)\s*$/gm)) {
    counts[match[1]] = Number(match[2])
  }
  const failed = [...stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim())
  return { ...counts, failedTests: failed }
}

async function runHost(host, ctx) {
  const record = {
    host,
    cordis: null,
    declared: null,
    install: null,
    tests: null,
    structuredMenu: null,
    verdict: 'fail',
    failures: [],
    warnings: [],
  }
  const started = Date.now()
  progress(`→ ${host}: resolving host packages …`)

  // 1) declared compatibility
  record.declared = evaluateDeclared(ctx.declaration, host, state.semver)
  if (record.declared.satisfied === false) record.failures.push(`declared: ${record.declared.reason}`)

  // 2) host package availability + cordis version the host itself wants
  let resolved
  try {
    resolved = await resolveHostPackages(host)
  } catch (error) {
    record.failures.push(`host packages: ${error?.message ?? error}`)
    record.durationMs = Date.now() - started
    return record
  }
  let cordis
  try {
    cordis = await chooseCordis(host, resolved.peerRanges)
  } catch (error) {
    record.failures.push(`cordis: ${error?.message ?? error}`)
    record.durationMs = Date.now() - started
    return record
  }
  record.cordis = cordis.cordis
  record.hostPackages = { published: resolved.published, unavailable: resolved.unavailable, registryErrors: resolved.errors, cordisPeerRanges: cordis.ranges }
  if (!cordis.cordis) {
    record.failures.push(`cordis resolution: ${cordis.conflict}`)
    record.durationMs = Date.now() - started
    return record
  }

  // 3) temp project + npm install
  const versions = { '@deepseek-ai/cordis': cordis.cordis }
  for (const name of resolved.published) versions[name] = host
  let dir
  try {
    dir = await prepareHostProject(host, { repoPackage: ctx.repoPackage, cordis: cordis.cordis })
  } catch (error) {
    record.failures.push(`prepare: ${error?.message ?? error}`)
    record.durationMs = Date.now() - started
    return record
  }
  record.tempDir = dir
  const specs = Object.entries(versions).map(([name, v]) => `${name}@${v}`)
  const installArgs = ['install', ...specs, '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', `--registry=${REGISTRY}`]
  progress(`→ ${host}: npm install ${specs.join(' ')} …`)
  const install = await run('npm', installArgs, { cwd: dir, env: npmEnv(), timeoutMs: INSTALL_TIMEOUT_MS })
  record.install = {
    ok: !install.timedOut && install.code === 0,
    command: shellish('npm', installArgs),
    cwd: dir,
    exitCode: install.code,
    timedOut: install.timedOut,
    timeoutMs: INSTALL_TIMEOUT_MS,
    durationMs: install.durationMs,
    stderrTail: tailLines(install.stderr),
  }
  if (record.install.ok) {
    // Prove the tree really holds the versions we asked for (npm may resolve
    // differently); a silent mismatch would make the whole matrix a lie.
    const installed = {}
    const mismatches = []
    for (const [name, wanted] of Object.entries(versions)) {
      const manifestPath = path.join(dir, 'node_modules', ...name.split('/'), 'package.json')
      let actual
      try {
        actual = JSON.parse(await readFile(manifestPath, 'utf8')).version
      } catch {
        actual = null
      }
      installed[name] = actual
      if (actual !== wanted) mismatches.push(`${name}: wanted ${wanted}, installed ${actual ?? 'missing'}`)
    }
    record.install.installed = installed
    if (mismatches.length) {
      record.install.ok = false
      record.failures.push(`install resolved unexpected versions: ${mismatches.join('; ')}`)
    }
  }
  if (!record.install.ok) {
    record.failures.push(
      install.timedOut
        ? `install timed out after ${INSTALL_TIMEOUT_MS} ms`
        : `install failed (exit ${install.code}): ${tailLines(install.stderr, 3).join(' | ') || 'no stderr'}`,
    )
  }

  // 4) the repo's own composition test, against the installed host packages
  if (record.install.ok) {
    const testArgs = ['--test', '--test-reporter=tap', TEST_FILE]
    progress(`→ ${host}: node ${testArgs.join(' ')} …`)
    const test = await run(process.execPath, testArgs, { cwd: dir, env: npmEnv(), timeoutMs: TEST_TIMEOUT_MS })
    const counts = parseTap(test.stdout)
    const total = counts.tests ?? 0
    const passed = counts.pass ?? 0
    const failed = counts.fail ?? 0
    record.tests = {
      ok: !test.timedOut && test.code === 0 && failed === 0 && total > 0,
      command: shellish(process.execPath, testArgs),
      cwd: dir,
      exitCode: test.code,
      timedOut: test.timedOut,
      timeoutMs: TEST_TIMEOUT_MS,
      durationMs: test.durationMs,
      passed,
      failed,
      total,
      skipped: counts.skipped ?? 0,
      failedTests: counts.failedTests,
      stderrTail: tailLines(test.stderr),
      stdoutTail: tailLines(test.stdout, 20),
    }
    if (!record.tests.ok) {
      record.failures.push(
        test.timedOut
          ? `composition test timed out after ${TEST_TIMEOUT_MS} ms`
          : `composition test failed: ${passed}/${total} passed, ${failed} failed${counts.failedTests.length ? ` (${counts.failedTests.join('; ')})` : ''}`,
      )
      if (!total) record.tests.stderrTail = tailLines(test.stderr || test.stdout)
    }
  }

  // 5) structured context-menu availability in the host UI bundle
  progress(`→ ${host}: probing ${UI_PACKAGE} for structured context menus …`)
  try {
    record.structuredMenu = await probeStructuredMenu(host, resolved)
  } catch (error) {
    record.structuredMenu = { available: null, status: 'error', reason: `probe failed: ${error?.message ?? error}`, package: UI_PACKAGE, version: host }
  }
  if (record.structuredMenu.status === 'error') {
    record.warnings.push(`structuredMenu probe could not determine support: ${record.structuredMenu.reason}`)
  }

  record.durationMs = Date.now() - started
  record.verdict = record.failures.length ? 'fail' : 'pass'
  return record
}

// ────────────────────────────────────────────────────────────────────────────
// built-artifact freshness (the matrix tests lib/, not src/)
// ────────────────────────────────────────────────────────────────────────────

async function newestMtime(dir, filter) {
  let newest = 0
  let file = null
  const walk = async (current) => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) { await walk(full); continue }
      if (filter && !filter(full)) continue
      const info = await stat(full)
      if (info.mtimeMs > newest) { newest = info.mtimeMs; file = full }
    }
  }
  await walk(dir)
  return { newest, file }
}

/** Warn (never silently pass) when src/ is newer than the built lib/ the matrix runs. */
async function libFreshness(repo) {
  const src = await newestMtime(path.join(repo, 'src'), (file) => /\.ts$/.test(file))
  const lib = await newestMtime(path.join(repo, 'lib'), (file) => /\.js$|.d\.ts$/.test(file))
  if (!src.newest || !lib.newest) return { checked: false, stale: null, reason: 'src/ or lib/ missing' }
  return {
    checked: true,
    stale: src.newest > lib.newest,
    srcNewest: src.file ? `${path.relative(repo, src.file)} @ ${new Date(src.newest).toISOString()}` : null,
    libNewest: lib.file ? `${path.relative(repo, lib.file)} @ ${new Date(lib.newest).toISOString()}` : null,
    note: 'the matrix runs the built lib/; run \`npm run build\` (or --self) if src/ changed',
  }
}

// ────────────────────────────────────────────────────────────────────────────
// rendering
// ────────────────────────────────────────────────────────────────────────────

function renderTable(report) {
  const header = ['host', 'cordis', 'declared', 'install', 'tests', 'menu', 'verdict']
  const rows = report.hosts.map((h) => [
    h.host,
    h.cordis ?? '—',
    h.declared?.satisfied === null ? 'none' : h.declared?.satisfied === true ? 'yes' : 'NO',
    h.install ? (h.install.ok ? `${h.install.durationMs} ms` : 'FAIL') : 'skipped',
    h.tests ? (h.tests.ok ? `${h.tests.passed}/${h.tests.total}` : `FAIL ${h.tests.passed}/${h.tests.total}`) : 'skipped',
    h.structuredMenu?.available === true ? 'yes' : h.structuredMenu?.available === false ? 'no' : 'unknown',
    h.verdict === 'pass' ? 'PASS' : 'FAIL',
  ])
  const widths = header.map((col, i) => Math.max(col.length, ...rows.map((row) => row[i].length)))
  const line = (cells) => cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ')
  return [line(header), line(widths.map((w) => '─'.repeat(w))), ...rows.map(line)].join('\n')
}

function renderHuman(report) {
  const out = []
  out.push(`compat matrix — ${report.plugin.name}@${report.plugin.version}`)
  out.push(`repo      ${report.repo}`)
  out.push(`toolchain node ${report.toolchain.node} · npm ${report.toolchain.npm} · registry ${report.registry}`)
  if (report.builtArtifacts?.checked) out.push(`built lib ${report.builtArtifacts.stale ? 'STALE — src/ is newer, run `npm run build`' : 'fresh (newer than src/)'}`)
  out.push(`declared  ${report.declaredCompatibility.source}: ${report.declaredCompatibility.requirements.map((r) => `${r.name} ${r.range}`).join(' · ') || '(none)'}`)
  out.push('')
  out.push(renderTable(report))
  out.push('')
  for (const host of report.hosts) {
    const notes = []
    if (host.failures.length) notes.push(...host.failures.map((f) => `failure: ${f}`))
    if (host.structuredMenu?.available === true) notes.push(`menu: ${host.structuredMenu.package}@${host.host} exposes contextMenus.register + workspace/session targets (client.js ${host.structuredMenu.clientBytes} B)`)
    if (host.structuredMenu?.available === false) notes.push(`menu: ${host.structuredMenu.status}: ${host.structuredMenu.reason}`)
    if (host.structuredMenu?.status === 'error') notes.push(`menu: UNKNOWN — ${host.structuredMenu.reason}`)
    if (host.warnings?.length) notes.push(...host.warnings.map((w) => `warning: ${w}`))
    if (host.install && !host.install.ok && host.install.stderrTail?.length) notes.push(`install stderr tail:\n    ${host.install.stderrTail.slice(-10).join('\n    ')}`)
    if (host.install?.ok) {
      const notable = (host.install.stderrTail ?? []).filter((line) => /ERESOLVE|EBADENGINE|E404|deprecated|peer/i.test(line)).slice(-5)
      if (notable.length) notes.push(`install warnings:\n    ${notable.join('\n    ')}`)
    }
    if (host.tests?.stderrTail?.length && !host.tests.ok) notes.push(`test stderr tail:\n    ${host.tests.stderrTail.join('\n    ')}`)
    if (notes.length) out.push(`- ${host.host}`, ...notes.map((n) => `    ${n.replace(/\n/g, '\n    ')}`))
  }
  if (report.selfCheck) {
    out.push('')
    out.push(`self check (npm run check): ${report.selfCheck.ok ? 'ok' : 'FAILED'} · exit ${report.selfCheck.exitCode} · ${report.selfCheck.durationMs} ms`)
    if (!report.selfCheck.ok) out.push(`    ${report.selfCheck.stderrTail.slice(-10).join('\n    ')}`)
  }
  out.push('')
  out.push(`report    ${report.reportPath}`)
  if (report.tempDirsKept?.length) out.push(`temp kept ${report.tempDirsKept.join(', ')}`)
  const failedHosts = report.hosts.filter((h) => h.verdict !== 'pass').map((h) => h.host)
  out.push(`result    ${report.ok ? 'PASS' : `FAIL (${failedHosts.length}/${report.hosts.length} hosts: ${failedHosts.join(', ')})`} · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return out.join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  parseArgs(process.argv.slice(2))
  state.semver = loadSemver()

  for (const host of OPTIONS.hosts) {
    if (!state.semver.valid(host)) throw new Error(`--hosts contains an invalid version: ${host}`)
  }

  const { text: repoPackageText, pkg: repoPackage } = await readRepoPackage(OPTIONS.repo)
  if (!repoPackage.name) throw new Error(`${OPTIONS.repo}/package.json has no name`)
  for (const required of ['lib/index.js', TEST_FILE]) {
    if (!existsSync(path.join(OPTIONS.repo, required))) {
      throw new Error(`repo is missing ${required} (run \`npm run build\` first?); looked under ${OPTIONS.repo}`)
    }
  }

  const freshness = await libFreshness(OPTIONS.repo)
  if (freshness.stale) {
    progress(`warning: src/ is newer than lib/ (${freshness.srcNewest} vs ${freshness.libNewest}) — the matrix tests the BUILT lib/, run \`npm run build\` for current code`)
  }

  state.runRoot = await mkdtemp(path.join(tmpdir(), 'dsh-compat-matrix-'))
  state.cacheDir = path.join(state.runRoot, 'npm-cache')
  progress(`compat-matrix: temp root ${state.runRoot}`)

  const declaration = declaredRequirements(repoPackage)
  const report = {
    schema: 'dsh-plugin-compat-matrix/1',
    generatedAt: new Date().toISOString(),
    repo: OPTIONS.repo,
    plugin: { name: repoPackage.name, version: repoPackage.version },
    toolchain: { node: process.version, npm: await npmVersion(), platform: `${process.platform}/${process.arch}` },
    registry: REGISTRY,
    options: { hosts: OPTIONS.hosts, keep: OPTIONS.keep, self: OPTIONS.self },
    builtArtifacts: freshness,
    declaredCompatibility: {
      source: declaration.source,
      requirements: declaration.requirements,
      note: 'host rule: engines.dsh when present, else every @deepseek-ai/dsh / @deepseek-ai/dsh-* peer; semver.satisfies(host, range, { includePrerelease: true })',
    },
    hosts: [],
    selfCheck: null,
    reportPath: null,
    tempDirsKept: null,
    ok: false,
  }

  try {
    for (const host of OPTIONS.hosts) {
      let record
      try {
        record = await runHost(host, { declaration, repoPackage: { text: repoPackageText, pkg: repoPackage } })
      } catch (error) {
        record = { host, verdict: 'fail', failures: [`unexpected error: ${error?.message ?? error}`], declared: null, install: null, tests: null, structuredMenu: null }
      }
      report.hosts.push(record)
      progress(`  ${host}: ${record.verdict === 'pass' ? 'pass' : 'FAIL'}`)
    }

    if (OPTIONS.self) {
      progress('→ self: npm run check (repo typecheck + build + tests) …')
      const self = await run('npm', ['run', 'check'], { cwd: OPTIONS.repo, env: npmEnv(), timeoutMs: SELF_TIMEOUT_MS })
      report.selfCheck = {
        ok: !self.timedOut && self.code === 0,
        command: 'npm run check',
        exitCode: self.code,
        timedOut: self.timedOut,
        durationMs: self.durationMs,
        stderrTail: tailLines(self.stderr),
        stdoutTail: tailLines(self.stdout, 20),
      }
      if (!report.selfCheck.ok) progress(`  self check FAILED (exit ${self.code}) — not part of the compatibility gate`)
    }
  } finally {
    if (!OPTIONS.keep) {
      await rm(state.runRoot, { recursive: true, force: true }).catch((error) => progress(`warning: could not remove ${state.runRoot}: ${error?.message ?? error}`))
    } else {
      report.tempDirsKept = [state.runRoot]
    }
  }

  const allInstalled = report.hosts.every((h) => h.install?.ok === true)
  const allTestsPassed = report.hosts.every((h) => h.tests?.ok === true)
  const declaredSatisfied = report.hosts.every((h) => h.declared?.satisfied !== false)
  report.checks = { allInstalled, allTestsPassed, declaredSatisfied }
  report.ok = report.hosts.length > 0 && report.hosts.every((h) => h.verdict === 'pass') && allInstalled && allTestsPassed && declaredSatisfied

  const reportsDir = path.join(OPTIONS.repo, 'reports')
  await mkdir(reportsDir, { recursive: true })
  const stamp = new Date()
  const day = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`
  report.reportPath = path.join(reportsDir, `compat-${day}.json`)
  await writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`)

  if (OPTIONS.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else log(renderHuman(report))

  process.exitCode = report.ok ? 0 : 1
}

async function npmVersion() {
  const result = await run('npm', ['--version'], { env: npmEnv(), timeoutMs: 30_000 })
  return result.code === 0 ? result.stdout.trim() : 'unknown'
}

main().catch((error) => {
  process.stderr.write(`compat-matrix failed: ${error?.message ?? error}\n`)
  if (process.env.DEBUG) process.stderr.write(`${error?.stack}\n`)
  process.exitCode = 2
})
