// Move Up — one-shot "move this workspace to the top" for DeepSeek Harness.
//
// Two backends are chosen at runtime so a DSH upgrade cannot silently break the
// feature:
//
//   1. Structured (preferred). `ctx.contextMenus.register({ target: 'workspace' })`
//      is the same public client API the built-in workspace menu actions use
//      (Rename / Delete). It is data, not DOM: the host renders the row, handles
//      keyboard navigation, closes the menu and reports failures.
//      Available on DSH >= 0.2.2 (the context-menu package ships with it).
//   2. DOM fallback. On hosts without that API the bundle decorates the rendered
//      workspace "…" menu, using tolerant selectors and a duplicate guard.
//
// Neither backend reorders anything by itself: the Host performs one
// `workspaceRegistry.insertBefore` through the plugin's server route.
window.__ModuleLoader__.load({
  id: 'dsh-move-up',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var MENU_ITEM = 'data-move-up'
    var LEGACY_ITEM = 'data-wshub-move-top'
    var API_PATH = 'api/plugins/dsh-move-up/move'
    var MOVE_ACTION = 'move-to-top'

    // Menu copy follows the host UI language (navigator.language), the same eight
    // locales the desktop app ships. Unknown languages fall back to English.
    var DICTIONARIES = {
      zh: { menu: '移到最上面', hint: '只调整一次顺序，之后仍可自由拖动。', busy: '正在调整顺序…', done: '已移到最上面', already: '已经在最上面', failed: '调整失败，请重试。' },
      en: { menu: 'Move to top', hint: 'Moves this workspace once; you can still drag afterwards.', busy: 'Moving to top…', done: 'Moved to top', already: 'Already at the top', failed: 'Could not move the workspace. Try again.' },
      ja: { menu: '一番上へ移動', hint: '一度だけ並べ替えます。後で自由にドラッグできます。', busy: '移動しています…', done: '一番上に移動しました', already: 'すでに一番上です', failed: '移動できませんでした。もう一度お試しください。' },
      es: { menu: 'Mover arriba', hint: 'Mueve este espacio una vez; después puedes arrastrarlo.', busy: 'Moviendo arriba…', done: 'Movido arriba', already: 'Ya está arriba', failed: 'No se pudo mover. Inténtalo de nuevo.' },
      fr: { menu: 'Déplacer en haut', hint: 'Déplace cet espace une fois ; vous pouvez encore le glisser.', busy: 'Déplacement…', done: 'Déplacé en haut', already: 'Déjà en haut', failed: 'Impossible de déplacer. Réessayez.' },
      de: { menu: 'Nach oben verschieben', hint: 'Verschiebt diesen Arbeitsbereich einmal; Ziehen bleibt möglich.', busy: 'Wird verschoben…', done: 'Nach oben verschoben', already: 'Bereits ganz oben', failed: 'Verschieben fehlgeschlagen. Erneut versuchen.' },
      ru: { menu: 'Переместить наверх', hint: 'Перемещает один раз; перетаскивание остаётся.', busy: 'Перемещение…', done: 'Перемещено наверх', already: 'Уже наверху', failed: 'Не удалось переместить. Повторите.' },
      pt: { menu: 'Mover para o topo', hint: 'Move uma vez; você ainda pode arrastar.', busy: 'Movendo…', done: 'Movido para o topo', already: 'Já está no topo', failed: 'Não foi possível mover. Tente novamente.' },
    }
    var LABELS = pickLabels(typeof navigator !== 'undefined' && navigator ? navigator.language : '')

    function pickLabels(language) {
      var tag = String(language || '').toLowerCase()
      var base = tag.split('-')[0]
      return DICTIONARIES[base] || DICTIONARIES.en
    }

    // One installation per host context, even if the loader activates the bundle twice.
    var INSTALLED = typeof WeakSet === 'function' ? new WeakSet() : null

    /** POST one exact workspace id; resolves with the server result or rejects. */
    function moveWorkspace(workspaceId) {
      return fetch(API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspaceId, action: MOVE_ACTION }),
      }).then(function (response) {
        return response.json().catch(function () { return null }).then(function (result) {
          if (!response.ok || !result || result.ok !== true) {
            throw new Error((result && result.message) || ('HTTP ' + response.status))
          }
          return result
        })
      })
    }

    /** Preferred backend: register a data contribution on the host's workspace menu.
     * @returns `absent` when this host has no structured menu API, `duplicate`
     * when another copy of this bundle already owns the contribution (the host row
     * is then already rendered — the DOM fallback must stay off), `ok` otherwise. */
    function installStructuredMenu(ctx, onActive, onRetired, onDuplicate) {
      if (!ctx || typeof ctx.inject !== 'function') return 'absent'
      var status = 'absent'
      var fiber = ctx.inject(['contextMenus'], function (scope) {
        try {
        var menus = scope.contextMenus
        if (!menus || typeof menus.register !== 'function') return
        scope.effect(function () {
          var dispose = menus.register({
            id: 'workspace.move-up',
            target: 'workspace',
            order: 50,
            resolve: function (target) {
              var workspaceId = target && target.workspaceId
              if (typeof workspaceId !== 'string' || workspaceId === '') return []
              return [{
                id: 'move-up',
                label: LABELS.menu,
                failureLabel: LABELS.failed,
                run: function () {
                  return moveWorkspace(workspaceId).then(function (result) {
                    if (menus && typeof menus.notify === 'function') {
                      menus.notify(result && result.moved === false ? LABELS.already : LABELS.done, true)
                    }
                  })
                },
              }]
            },
          })
          status = 'ok'
          onActive()
          return function () {
            // The host withdrew its menu API or is replacing this client entry.
            // Drop the structured claim so the DOM fallback can take over instead
            // of leaving the workspace menu empty until a page reload.
            try { dispose() } catch (error) { /* already gone */ }
            onRetired()
          }
        })
        } catch (error) {
          // Duplicate contribution = a second copy of this bundle is active and
          // already owns the host row. Do not add a DOM row on top of it.
          var message = String((error && error.message) || error || '')
          if (/duplicate/i.test(message)) {
            status = 'duplicate'
            onDuplicate()
          } else {
            status = 'absent'
          }
        }
      })
      // A host may start the injected child asynchronously; a rejection there
      // must stay a capability miss, not an unhandled client-entry error.
      if (fiber && typeof fiber.catch === 'function') fiber.catch(function () {})
      return status
    }

    /** Fallback backend: decorate the rendered workspace "…" menu. */
    function installDomMenu(ctx, structuredActive) {
      var workspaceId = null
      var busy = false
      var observer = null
      var timer = null
      var buttons = new Set()

      function rowId(row) {
        var key = (row && row.getAttribute && row.getAttribute('data-row-key')) || ''
        return key.slice('workspace:'.length) || null
      }

      function rowOf(target) {
        var row = target && target.closest && target.closest('[data-row-key^="workspace:"]')
        return row ? rowId(row) : null
      }

      // Capture the row whose native workspace action button opened this menu.
      function onPointerDown(event) {
        if (!(event.target instanceof Element)) return
        var button = event.target.closest('button[aria-label]')
        if (event.target.closest('[role="menu"]')) return
        if (!button || button.hasAttribute('aria-keyshortcuts')) {
          workspaceId = null
          return
        }
        var row = button.closest('[data-row-key^="workspace:"]')
        workspaceId = row && row.querySelector('button[aria-label]') === button ? rowOf(button) : null
      }

      function closeNativeMenu() {
        // Closing the native menu removes the extension row with it.
        var trigger = document.activeElement
        if (trigger && trigger.closest && trigger.closest('[data-row-key^="workspace:"]')) trigger.click()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      }

      function moveToTop(button) {
        var id = button.dataset.moveUpWorkspaceId
        if (!id || busy) return
        busy = true
        button.disabled = true
        button.title = LABELS.busy
        moveWorkspace(id).then(function () {
          button.title = LABELS.done
          closeNativeMenu()
          // DOM teardown is authoritative; the Host publishes the new order.
        }).catch(function (error) {
          button.disabled = false
          var message = error instanceof Error ? error.message : String(error)
          button.title = LABELS.failed + ' ' + message
          button.setAttribute('aria-label', button.title)
        }).then(function () {
          busy = false
        })
      }

      function buildItem(menu, template) {
        var viewport = menu.querySelector('[role="presentation"]') || menu
        // Clone only native menu classes/row structure; do not copy its actions.
        var wrapperParent = template.parentElement
        var wrapper = wrapperParent ? wrapperParent.cloneNode(false) : document.createElement('div')
        var button = template.cloneNode(false)
        button.setAttribute(MENU_ITEM, '1')
        button.dataset.moveUpWorkspaceId = workspaceId
        button.removeAttribute('class')
        button.className = template.className
        button.setAttribute('aria-label', LABELS.menu)
        button.title = LABELS.hint
        var spans = template.querySelectorAll('span')
        if (spans[0]) {
          var icon = document.createElement('span')
          icon.className = spans[0].className
          icon.textContent = '↑'
          button.appendChild(icon)
        }
        var label = document.createElement('span')
        var labelTemplate = spans[1] || spans[0]
        if (labelTemplate) label.className = labelTemplate.className
        label.textContent = LABELS.menu
        button.appendChild(label)
        button.addEventListener('click', function (event) {
          event.preventDefault()
          event.stopPropagation()
          moveToTop(event.currentTarget)
        })
        wrapper.appendChild(button)
        viewport.insertBefore(wrapper, viewport.firstChild)
        buttons.add(button)
      }

      function decorate() {
        observer.disconnect()
        try {
          if (structuredActive()) return
          if (!workspaceId) return
          // Only the menu that the captured workspace row opened. Submenus and
          // unrelated menus (tabs, panels) must not receive this workspace's row.
          var menus = document.querySelectorAll('[role="menu"]')
          for (var i = 0; i < menus.length; i++) {
            var menu = menus[i]
            if (!menuBelongsToWorkspace(menu)) continue
            if (menu.querySelector('[' + MENU_ITEM + ']')) continue
            // The legacy sibling plugin already decorated this menu: never show
            // two identical actions.
            if (menu.querySelector('[' + LEGACY_ITEM + ']')) continue
            var template = menu.querySelector('button[role="menuitem"]')
            if (!template) continue
            buildItem(menu, template)
          }
        } finally {
          observer.observe(document.documentElement, { childList: true, subtree: true })
        }
      }

      /** A workspace menu is the one that the captured workspace row opened.
       * Submenus and unrelated menus must not receive this workspace's row. The
       * captured `workspaceId` (set on the row's own action pointerdown) is the
       * only ownership signal; `aria-expanded`, when a host provides it, must not
       * say the trigger is closed. */
      function menuBelongsToWorkspace(menu) {
        if (!workspaceId) return false
        if (menu.getAttribute && menu.getAttribute('data-submenu') !== null) return false
        var rows = document.querySelectorAll('[data-row-key^="workspace:"]')
        for (var r = 0; r < rows.length; r++) {
          if (rowId(rows[r]) !== workspaceId) continue
          var opener = rows[r].querySelector('button[aria-label]')
          var expanded = opener && opener.getAttribute('aria-expanded')
          return expanded !== 'false'
        }
        return false
      }

      function buildItem(menu, template) {
        var viewport = menu.querySelector('[role="presentation"]') || menu
        // Clone only native menu classes/row structure; do not copy its actions.
        var wrapperParent = template.parentElement
        var wrapper = wrapperParent ? wrapperParent.cloneNode(false) : document.createElement('div')
        var button = template.cloneNode(false)
        button.setAttribute(MENU_ITEM, '1')
        button.dataset.moveUpWorkspaceId = workspaceId
        button.removeAttribute('class')
        button.className = template.className
        button.setAttribute('aria-label', LABELS.menu)
        button.title = LABELS.hint
        var spans = template.querySelectorAll('span')
        if (spans[0]) {
          var icon = document.createElement('span')
          icon.className = spans[0].className
          icon.textContent = '↑'
          button.appendChild(icon)
        }
        var label = document.createElement('span')
        var labelTemplate = spans[1] || spans[0]
        if (labelTemplate) label.className = labelTemplate.className
        label.textContent = LABELS.menu
        button.appendChild(label)
        button.addEventListener('click', function (event) {
          event.preventDefault()
          event.stopPropagation()
          moveToTop(event.currentTarget)
        })
        wrapper.appendChild(button)
        viewport.insertBefore(wrapper, viewport.firstChild)
        buttons.add(button)
      }

      function decorate() {
        observer.disconnect()
        try {
          if (structuredActive()) return
          if (!workspaceId) return
          // Only the menu that the captured workspace row opened. Submenus and
          // unrelated menus (tabs, panels) must not receive this workspace's row.
          var menus = document.querySelectorAll('[role="menu"]')
          for (var i = 0; i < menus.length; i++) {
            var menu = menus[i]
            if (!menuBelongsToWorkspace(menu)) continue
            if (menu.querySelector('[' + MENU_ITEM + ']')) continue
            // The legacy sibling plugin already decorated this menu: never show
            // two identical actions.
            if (menu.querySelector('[' + LEGACY_ITEM + ']')) continue
            var template = menu.querySelector('button[role="menuitem"]')
            if (!template) continue
            buildItem(menu, template)
          }
        } finally {
          observer.observe(document.documentElement, { childList: true, subtree: true })
        }
      }

      /** A workspace menu is the one opened from that workspace's own action button. */
      function menuBelongsToWorkspace(menu) {
        if (!workspaceId) return false
        if (menu.closest && menu.closest('[role="menu"][data-submenu]')) return false
        var rows = document.querySelectorAll('[data-row-key^="workspace:"]')
        var row = null
        for (var r = 0; r < rows.length; r++) {
          if (rowId(rows[r]) === workspaceId) { row = rows[r]; break }
        }
        var opener = row && row.querySelector('button[aria-label]')
        var expanded = opener && opener.getAttribute('aria-expanded')
        // Hosts that do not expose aria-expanded still have one open workspace menu
        // at a time; fall back to the single-menu rule below.
        if (expanded === 'true') return true
        return document.querySelectorAll('[role="menu"]').length === 1
      }
      function schedule() {
        if (timer !== null) return
        timer = setTimeout(function () { timer = null; decorate() }, 40)
      }

      observer = new MutationObserver(schedule)
      observer.observe(document.documentElement, { childList: true, subtree: true })
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onPointerDown, true)

      return function dispose() {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onPointerDown, true)
        observer.disconnect()
        if (timer !== null) clearTimeout(timer)
        buttons.forEach(function (button) { button.remove() })
        buttons.clear()
      }
    }

    function apply(ctx) {
      if (INSTALLED) {
        if (INSTALLED.has(ctx)) return
        INSTALLED.add(ctx)
      }
      var disposers = []
      var domDispose = null
      // Two independent facts: the host renders our row (structured) and another
      // copy of this bundle owns that row (duplicate). The DOM fallback runs only
      // while neither is true.
      var state = { structured: false, duplicate: false }

      function stopDom() {
        if (!domDispose) return
        var dispose = domDispose
        domDispose = null
        try { dispose() } catch (error) { /* teardown must not throw */ }
      }

      var domTimer = null
      function startDom() {
        if (domDispose || state.structured || state.duplicate || domTimer !== null) return
        // Defer one turn: on hosts with the structured menu API the injected child
        // registers right after activation, and this fallback then never runs.
        domTimer = setTimeout(function () {
          domTimer = null
          startDomNow()
        }, 0)
      }

      function startDomNow() {
        if (domDispose || state.structured || state.duplicate) return
        try {
          domDispose = installDomMenu(ctx, function () { return state.structured || state.duplicate })
          if (domDispose) disposers.push(domDispose)
        } catch (error) {
          domDispose = null
        }
      }

      try {
        installStructuredMenu(ctx, function () {
          state.structured = true
          stopDom()
        }, function () {
          // Host withdrew the menu API: give the workspace menu back to the DOM
          // fallback instead of leaving it without the action until a reload.
          state.structured = false
          startDom()
        }, function () {
          // A second copy of this bundle already renders the host row; adding a
          // DOM row would show the action twice.
          state.duplicate = true
          stopDom()
        })
      } catch (error) {
        // Capability miss, never a plugin failure.
      }

      // Covers the async case: the injected child has not registered yet, so the
      // fallback starts now and is retired by the onActive callback above.
      startDom()

      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () {
            disposers.forEach(function (dispose) {
              try { dispose() } catch (error) { /* teardown must not throw */ }
            })
            disposers.length = 0
            domDispose = null
            if (domTimer !== null) { clearTimeout(domTimer); domTimer = null }
          }
        })
      }
    }

    exports.apply = apply
    exports.labels = pickLabels
    return module.exports
  },
})
