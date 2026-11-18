import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// The client bundle is a browser classic-script wrapper; run it under Node with
// a minimal fake DOM/fetch/timers so both backends (structured context menu and
// DOM fallback) are verified without a browser or a new dependency.

// Menu copy follows navigator.language; pin it so label assertions are deterministic.
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })

const CLIENT_URL = new URL('../client/client.js', import.meta.url)
const MOVE_API = 'api/plugins/dsh-move-up/move'

// ---------------------------------------------------------------- //
// Minimal fake DOM
// ---------------------------------------------------------------- //

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.children = []
    this.parentNode = null
    this.attributes = new Map()
    this.style = {}
    this.listeners = new Map()
    this.textContent = ''
    this.title = ''
    this.disabled = false
    this.draggable = false
    this.removed = false
    this.className = ''
    this.dataset = {}
    this.classList = { contains: () => false }
  }

  get parentElement() { return this.parentNode }
  get firstElementChild() { return this.children[0] || null }

  closest(selector) {
    for (let node = this; node; node = node.parentNode) {
      if (selector === '[data-row-key^="workspace:"]' && (node.getAttribute('data-row-key') || '').startsWith('workspace:')) return node
      if (selector === 'button[aria-label]' && node.tagName === 'BUTTON' && node.getAttribute('aria-label')) return node
      if (selector === '[role="menu"]' && node.getAttribute('role') === 'menu') return node
    }
    return null
  }

  cloneNode() {
    const clone = new FakeElement(this.tagName)
    clone.attributes = new Map(this.attributes)
    clone.className = this.className
    return clone
  }

  matches(selector) {
    if (selector === 'span') return this.tagName === 'SPAN'
    if (selector === 'button[aria-label]') return this.tagName === 'BUTTON' && Boolean(this.getAttribute('aria-label'))
    if (selector === 'button[role="menuitem"]') return this.tagName === 'BUTTON' && this.getAttribute('role') === 'menuitem'
    if (selector === '[role="presentation"]') return this.getAttribute('role') === 'presentation'
    if (selector === '[role="menu"]') return this.getAttribute('role') === 'menu'
    if (selector === '[data-move-up]') return this.hasAttribute('data-move-up')
    if (selector === '[data-wshub-move-top]') return this.hasAttribute('data-wshub-move-top')
    if (selector === '[role="menu"][data-menu-material="translucent"]') return this.getAttribute('role') === 'menu' && this.getAttribute('data-menu-material') === 'translucent'
    return false
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  querySelectorAll(selector) {
    const matches = []
    const walk = (node) => {
      if (node.matches(selector)) matches.push(node)
      node.children.forEach(walk)
    }
    this.children.forEach(walk)
    return matches
  }

  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== fn))
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  hasAttribute(name) { return this.attributes.has(name) }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    return child
  }

  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child)
    const at = this.children.indexOf(before)
    this.children.splice(at < 0 ? this.children.length : at, 0, child)
    child.parentNode = this
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index !== -1) this.children.splice(index, 1)
    child.parentNode = null
    return child
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this)
    this.removed = true
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(fn)
  }

  dispatch(type, event = {}) {
    if (event.currentTarget === undefined) event.currentTarget = this
    const fns = this.listeners.get(type) || []
    for (const fn of [...fns]) fn.call(this, event)
  }

  get lastElementChild() {
    return this.children.length > 0 ? this.children[this.children.length - 1] : null
  }
}

function createDocument() {
  const html = new FakeElement('html')
  const body = new FakeElement('body')
  html.appendChild(body)
  const elements = [html, body]
  return Object.assign(body, {
    html,
    body,
    documentElement: html,
    dispatchEvent(event) { return this.dispatch(event.type, event) },
    createElement: (tag) => new FakeElement(tag),
    querySelectorAll(selector) {
      if (selector === '[data-row-key^="workspace:"]') {
        return elements.filter((el) => (el.getAttribute('data-row-key') || '').startsWith('workspace:'))
      }
      if (selector === '[role="menu"]') return elements.filter((el) => el.getAttribute('role') === 'menu')
      if (selector === '[role="menu"][data-menu-material="translucent"]') return elements.filter((el) => el.getAttribute('role') === 'menu' && el.getAttribute('data-menu-material') === 'translucent')
      return []
    },
    register(el) {
      elements.push(el)
      return el
    },
  })
}

function makeRow(document, id) {
  const row = new FakeElement('div')
  row.setAttribute('role', 'treeitem')
  row.setAttribute('data-row-key', `workspace:${id}`)
  document.register(row)
  document.body.appendChild(row)
  return row
}

/** Render one workspace row plus its opened "…" menu, mirroring the host DOM.
 * `options.material` lets a test drop the decorative menu attributes a future
 * host may stop rendering. */
function openWorkspaceMenu(document, id, options = {}) {
  const row = makeRow(document, id)
  const trigger = new FakeElement('button')
  trigger.setAttribute('aria-label', '工作区操作')
  row.appendChild(trigger)
  if (id) document.dispatch('pointerdown', { target: trigger })
  const menu = new FakeElement('div')
  menu.setAttribute('role', 'menu')
  if (options.material !== false) menu.setAttribute('data-menu-material', 'translucent')
  const material = new FakeElement('div')
  material.setAttribute('aria-hidden', 'true')
  menu.appendChild(material)
  const viewport = new FakeElement('div')
  viewport.setAttribute('role', 'presentation')
  const wrapper = new FakeElement('div')
  const native = new FakeElement('button')
  native.className = 'native-menu-item'
  native.setAttribute('role', 'menuitem')
  const icon = new FakeElement('span')
  icon.className = 'native-menu-icon'
  native.appendChild(icon)
  const label = new FakeElement('span')
  label.className = 'native-menu-label'
  native.appendChild(label)
  if (options.legacyItem) {
    const legacy = new FakeElement('button')
    legacy.setAttribute('role', 'menuitem')
    legacy.setAttribute('data-wshub-move-top', '1')
    wrapper.appendChild(legacy)
  }
  wrapper.appendChild(native)
  viewport.appendChild(wrapper)
  menu.appendChild(viewport)
  document.register(menu)
  document.body.appendChild(menu)
  FakeMutationObserver.instances.at(-1)?.trigger()
  return menu
}

// ---------------------------------------------------------------- //
// Fake platform primitives
// ---------------------------------------------------------------- //

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb
    this.connected = false
    this.target = null
    ;(FakeMutationObserver.instances ||= []).push(this)
  }
  observe(target, options) {
    this.target = target
    this.options = options
    this.connected = true
  }
  disconnect() {
    this.connected = false
  }
  trigger() {
    if (this.connected) this.cb([], this)
  }
}
FakeMutationObserver.instances = []

class FakeAbortController {
  constructor() {
    this.signal = { aborted: false, reason: undefined }
    this.aborted = false
    ;(FakeAbortController.instances ||= []).push(this)
  }
  abort(reason) {
    this.aborted = true
    this.signal.aborted = true
    this.signal.reason = reason
  }
}
FakeAbortController.instances = []

function createTimers() {
  let seq = 0
  const timers = new Map()
  return {
    setTimeout(fn, ms) {
      const id = ++seq
      timers.set(id, { fn, ms })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    pending() {
      return timers.size
    },
    flush() {
      const ids = [...timers.keys()]
      for (const id of ids) {
        const timer = timers.get(id)
        timers.delete(id)
        timer.fn()
      }
    },
  }
}

function createFetch() {
  const calls = []
  let handler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, moved: true, order: [], workspaces: [] }) })
  async function fetch(url, init) {
    calls.push({ url, init })
    return await handler(url, init)
  }
  return {
    fetch,
    calls,
    respond(fn) {
      handler = fn
    },
  }
}

// ---------------------------------------------------------------- //
// Bundle loader
// ---------------------------------------------------------------- //

/** Minimal React stand-in: the bundle only needs createElement for the glyph. */
const fakeReact = {
  createElement(tag, props, ...children) {
    return { tag, props, children }
  },
}

function loadClient(deps, requireImpl) {
  const source = readFileSync(CLIENT_URL, 'utf8')
  const runner = new Function(
    'window',
    'document',
    'MutationObserver',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'AbortController',
    source,
  )
  const registry = {}
  const fakeWindow = {
    __ModuleLoader__: {
      load(spec) {
        registry[spec.id] = spec
      },
    },
  }
  runner(
    fakeWindow,
    deps.document,
    deps.MutationObserver,
    deps.fetch,
    deps.setTimeout,
    deps.clearTimeout,
    deps.AbortController,
  )
  const spec = registry['dsh-move-up']
  assert.ok(spec, 'bundle registers under the wrapper id dsh-move-up')
  const mod = spec.factory(requireImpl || function require() {
    throw new Error('client bundle must not require any module')
  })
  assert.equal(typeof mod.apply, 'function', 'bundle exports apply(ctx)')
  return mod
}

/** Host context: cordis effect() plus, on hosts that have it, ctx.inject(). */
function createCtx({ menus, slots = true } = {}) {
  const disposers = []
  const contributions = []
  const notifications = []
  const scope = {
    effect(callback) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    contextMenus: menus === undefined ? undefined : {
      register(contribution) {
        contributions.push(contribution)
        return () => {
          const index = contributions.indexOf(contribution)
          if (index !== -1) contributions.splice(index, 1)
        }
      },
      notify(text, success) {
        notifications.push({ text, success })
      },
    },
  }
  const iconSlots = []
  if (slots) {
    scope.slots = {
      inject(name, factory) {
        if (name !== 'contextMenu.icon') return
        for (const registration of factory()) iconSlots.push(registration)
      },
      register(spec, component) {
        return { spec, component }
      },
    }
  }
  const ctx = {
    disposers,
    contributions,
    notifications,
    iconSlots,
    effect: scope.effect,
    inject(names, callback) {
      if (!Array.isArray(names) || !names.includes('contextMenus')) return
      if (menus === false) return
      callback(scope)
    },
  }
  return ctx
}

function mount(t, { response, menus, slots = true } = {}) {
  global.Element = FakeElement
  global.KeyboardEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init) } }
  const document = createDocument()
  const timers = createTimers()
  const fakeFetch = createFetch()
  if (response) fakeFetch.respond(response)
  FakeMutationObserver.instances = []
  const mod = loadClient({ document, MutationObserver: FakeMutationObserver, fetch: fakeFetch.fetch, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }, (name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require: ${name}`)
  })
  const ctx = createCtx({ menus, slots })
  mod.apply(ctx)
  // The client defers the DOM fallback by one turn so a structured registration
  // that lands first never builds an observer. Run that turn now.
  timers.flush()
  t.after(() => { ctx.disposers.forEach((dispose) => dispose()); delete global.Element; delete global.KeyboardEvent })
  return { document, timers, fakeFetch, ctx, mod }
}

// ---------------------------------------------------------------- //
// DOM fallback (hosts without the structured menu API)
// ---------------------------------------------------------------- //

test('fallback: one native-styled move action appears and nothing is read on open', async (t) => {
  const { document, timers, fakeFetch } = mount(t, { menus: false })
  const menu = openWorkspaceMenu(document, 'ws-1')
  timers.flush()
  assert.equal(menu.querySelectorAll('[data-move-up]').length, 1)
  assert.equal(menu.querySelector('[data-move-up]').className, 'native-menu-item')
  assert.equal(fakeFetch.calls.length, 0)
  timers.flush()
  assert.equal(menu.querySelectorAll('[data-move-up]').length, 1)
})

test('fallback: click sends one exact-ID move command and reports failure honestly', async (t) => {
  let fail = true
  const { document, timers, fakeFetch } = mount(t, {
    menus: false,
    response: async (url, init) => {
      assert.equal(url, MOVE_API)
      assert.deepEqual(JSON.parse(init.body), { workspaceId: 'ws-1', action: 'move-to-top' })
      if (fail) return { ok: false, status: 409, json: async () => ({ ok: false, message: '工作区已不存在' }) }
      return { ok: true, status: 200, json: async () => ({ ok: true, moved: true }) }
    },
  })
  const menu = openWorkspaceMenu(document, 'ws-1')
  timers.flush()
  const button = menu.querySelector('[data-move-up]')
  click(button)
  await settle()
  assert.equal(button.disabled, false)
  assert.match(button.title, /工作区已不存在/)
  fail = false
  click(button)
  await settle()
  assert.equal(button.title, '已移到最上面')
  assert.equal(fakeFetch.calls.length, 2)
})

test('fallback: another menu does not inherit the prior workspace target', (t) => {
  const { document, timers } = mount(t, { menus: false })
  openWorkspaceMenu(document, 'ws-1')
  const plus = new FakeElement('button')
  plus.setAttribute('aria-label', '新建会话')
  plus.setAttribute('aria-keyshortcuts', 'Meta+N')
  document.body.appendChild(plus)
  document.dispatch('pointerdown', { target: plus })
  const sessionMenu = openWorkspaceMenu(document, null)
  timers.flush()
  assert.equal(sessionMenu.querySelector('[data-move-up]'), null)
})

test('fallback: survives a host that drops the decorative menu attributes', (t) => {
  const { document, timers } = mount(t, { menus: false })
  const menu = openWorkspaceMenu(document, 'ws-1', { material: false })
  timers.flush()
  assert.equal(menu.querySelectorAll('[data-move-up]').length, 1)
})

test('fallback: never duplicates the legacy sibling plugin row', (t) => {
  const { document, timers } = mount(t, { menus: false })
  const menu = openWorkspaceMenu(document, 'ws-1', { legacyItem: true })
  timers.flush()
  assert.equal(menu.querySelectorAll('[data-move-up]').length, 0)
})

test('fallback: unloading removes the extension and its listeners', (t) => {
  const { document, timers, ctx } = mount(t, { menus: false })
  const menu = openWorkspaceMenu(document, 'ws-1')
  timers.flush()
  assert.ok(menu.querySelector('[data-move-up]'))
  ctx.disposers.forEach((dispose) => dispose())
  assert.equal(menu.querySelector('[data-move-up]'), null)
  assert.equal(FakeMutationObserver.instances.at(-1).connected, false)
  assert.equal(timers.pending(), 0)
})

// ---------------------------------------------------------------- //
// Structured backend (hosts that expose ctx.contextMenus)
// ---------------------------------------------------------------- //

test('structured: registers one workspace data contribution and renders no DOM row', async (t) => {
  const { document, timers, ctx } = mount(t, { menus: {} })
  assert.equal(ctx.contributions.length, 1)
  const contribution = ctx.contributions[0]
  assert.equal(contribution.target, 'workspace')
  assert.equal(contribution.order, 50)
  assert.equal(typeof contribution.resolve, 'function')

  const menu = openWorkspaceMenu(document, 'ws-1')
  timers.flush()
  assert.equal(menu.querySelectorAll('[data-move-up]').length, 0, 'structured hosts must not get a cloned DOM row')

  const actions = contribution.resolve({ workspaceId: 'ws-1', path: '/p', displayTitle: 'P' })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].id, 'move-up')
  assert.equal(actions[0].label, '移到最上面')
  assert.equal(actions[0].failureLabel, '调整失败，请重试。')
  assert.deepEqual(contribution.resolve({}), [], 'a target without an id yields no action')
  assert.deepEqual(contribution.resolve({ workspaceId: '' }), [], 'an empty id yields no action')
})

test('structured: contributes an up-arrow glyph and declares its icon key', (t) => {
  const { ctx } = mount(t, { menus: {} })
  assert.equal(ctx.iconSlots.length, 1, 'one keyed contextMenu.icon registration')
  const registration = ctx.iconSlots[0]
  assert.equal(registration.spec.name, 'contextMenu.icon')
  assert.equal(registration.spec.key, 'workspace.move-up')
  const element = registration.component({ icon: { key: 'workspace.move-up' } })
  assert.equal(element.tag, 'svg')
  assert.equal(element.props.stroke, 'currentColor')
  const paths = element.children.filter(child => child && child.tag === 'path')
  assert.equal(paths.length, 2, 'shaft + chevron')
  const [action] = ctx.contributions[0].resolve({ workspaceId: 'ws-1' })
  assert.deepEqual(action.icon, { key: 'workspace.move-up' })
})

test('structured: run posts the captured workspace id and notifies success', async (t) => {
  const { ctx, fakeFetch } = mount(t, { menus: {} })
  fakeFetch.respond(async (url, init) => {
    assert.equal(url, MOVE_API)
    assert.deepEqual(JSON.parse(init.body), { workspaceId: 'ws-7', action: 'move-to-top' })
    return { ok: true, status: 200, json: async () => ({ ok: true, moved: true }) }
  })
  const [action] = ctx.contributions[0].resolve({ workspaceId: 'ws-7' })
  await action.run()
  assert.deepEqual(ctx.notifications, [{ text: '已移到最上面', success: true }])
})

test('structured: an already-first workspace reports "already" instead of moving', async (t) => {
  const { ctx, fakeFetch } = mount(t, { menus: {} })
  fakeFetch.respond(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, moved: false }) }))
  const [action] = ctx.contributions[0].resolve({ workspaceId: 'ws-1' })
  await action.run()
  assert.deepEqual(ctx.notifications, [{ text: '已经在最上面', success: true }])
})

test('structured: a rejected move surfaces as a rejection the host turns into failureLabel', async (t) => {
  const { ctx, fakeFetch } = mount(t, { menus: {} })
  fakeFetch.respond(async () => ({ ok: false, status: 501, json: async () => ({ ok: false, message: '当前 DSH 版本不支持调整工作区顺序，请升级 Move Up 插件' }) }))
  const [action] = ctx.contributions[0].resolve({ workspaceId: 'ws-1' })
  await assert.rejects(() => action.run(), /不支持调整工作区顺序/)
  assert.deepEqual(ctx.notifications, [], 'a failed move must not claim success')
})

test('degradation: a throwing contextMenus registration keeps the DOM fallback working', (t) => {
  global.Element = FakeElement
  global.KeyboardEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init) } }
  const document = createDocument()
  const timers = createTimers()
  const fakeFetch = createFetch()
  FakeMutationObserver.instances = []
  const mod = loadClient({ document, MutationObserver: FakeMutationObserver, fetch: fakeFetch.fetch, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
  const ctx = {
    effect(callback) { return callback() },
    inject(names, callback) {
      callback({ effect: (fn) => fn(), contextMenus: { register() { throw new Error('host changed the menu API') } } })
    },
  }
  mod.apply(ctx)
  timers.flush()
  const menu = openWorkspaceMenu(document, 'ws-1')
  timers.flush()
  assert.equal(menu.querySelectorAll('[data-move-up]').length, 1)
  delete global.Element
  delete global.KeyboardEvent
})

// ---------------------------------------------------------------- //
// Localization
// ---------------------------------------------------------------- //

test('labels: eight host locales plus an English fallback', (t) => {
  const { mod } = mount(t, { menus: false })
  for (const language of ['zh-CN', 'en-US', 'ja-JP', 'es-ES', 'fr-FR', 'de-DE', 'ru-RU', 'pt-BR']) {
    const labels = mod.labels(language)
    assert.equal(typeof labels.menu, 'string')
    assert.ok(labels.menu.length > 0, `${language} has a menu label`)
  }
  assert.equal(mod.labels('ko-KR').menu, 'Move to top')
  assert.equal(mod.labels(undefined).menu, 'Move to top')
})

// ---------------------------------------------------------------- //

function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

function click(button) {
  let stopped = false
  let prevented = false
  button.dispatch('click', {
    preventDefault() {
      prevented = true
    },
    stopPropagation() {
      stopped = true
    },
  })
  return { stopped, prevented }
}

test('degradation: a host context without inject() still gets the DOM backend', (t) => {
  global.Element = FakeElement
  global.KeyboardEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init) } }
  const document = createDocument()
  const timers = createTimers()
  const fakeFetch = createFetch()
  FakeMutationObserver.instances = []
  const mod = loadClient({ document, MutationObserver: FakeMutationObserver, fetch: fakeFetch.fetch, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
  mod.apply({ effect(callback) { return callback() } })
  timers.flush()
  const menu = openWorkspaceMenu(document, 'ws-1')
  timers.flush()
  assert.equal(menu.querySelectorAll('[data-move-up]').length, 1)
  delete global.Element
  delete global.KeyboardEvent
})
