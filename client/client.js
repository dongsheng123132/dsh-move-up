// Move Up — one-shot "move this workspace to the top" for DeepSeek Harness.
//
// Two backends, picked once at activation:
//   - structured (DSH >= 0.2.2): ctx.contextMenus.register({ target: 'workspace' })
//     — data only; the host renders the row, the glyph, keyboard handling and
//     failure feedback, like its built-in Rename/Delete actions.
//   - DOM (older hosts): decorate the workspace "…" menu once per open.
//
// Neither backend reorders anything by itself: a click becomes one POST that the
// host turns into one workspaceRegistry.insertBefore, the same durable write as a
// manual drag. No state, no background work.
window.__ModuleLoader__.load({
  id: 'dsh-move-up',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var API_PATH = 'api/plugins/dsh-move-up/move'
    var MOVE_ACTION = 'move-to-top'
    var MARKER = 'data-move-up'
    var LEGACY_MARKER = 'data-wshub-move-top'
    var ICON_KEY = 'workspace.move-up'

    // [menu, hint, done, already, failed] per host locale; unknown → English.
    var DICTIONARIES = {
      zh: ['移到最上面', '只调整一次顺序，之后仍可自由拖动。', '已移到最上面', '已经在最上面', '调整失败，请重试。'],
      en: ['Move to top', 'Moves this workspace once; you can still drag afterwards.', 'Moved to top', 'Already at the top', 'Could not move the workspace. Try again.'],
      ja: ['一番上へ移動', '一度だけ並べ替えます。後で自由にドラッグできます。', '一番上に移動しました', 'すでに一番上です', '移動できませんでした。もう一度お試しください。'],
      es: ['Mover arriba', 'Mueve este espacio una vez; después puedes arrastrarlo.', 'Movido arriba', 'Ya está arriba', 'No se pudo mover. Inténtalo de nuevo.'],
      fr: ['Déplacer en haut', 'Déplace cet espace une fois ; vous pouvez encore le glisser.', 'Déplacé en haut', 'Déjà en haut', 'Impossible de déplacer. Réessayez.'],
      de: ['Nach oben verschieben', 'Verschiebt diesen Arbeitsbereich einmal; Ziehen bleibt möglich.', 'Nach oben verschoben', 'Bereits ganz oben', 'Verschieben fehlgeschlagen. Erneut versuchen.'],
      ru: ['Переместить наверх', 'Перемещает один раз; перетаскивание остаётся.', 'Перемещено наверх', 'Уже наверху.', 'Не удалось переместить. Повторите.'],
      pt: ['Mover para o topo', 'Move uma vez; você ainda pode arrastar.', 'Movido para o topo', 'Já está no topo', 'Não foi possível mover. Tente novamente.'],
    }
    var LABELS = pickLabels(typeof navigator !== 'undefined' && navigator ? navigator.language : '')

    function pickLabels(language) {
      var words = DICTIONARIES[String(language || '').toLowerCase().split('-')[0]] || DICTIONARIES.en
      return { menu: words[0], hint: words[1], done: words[2], already: words[3], failed: words[4] }
    }

    // One installation per host context, even if the loader activates twice.
    var INSTALLED = new WeakSet()

    // `react` is host-provided; without it the row simply has no glyph.
    var React = null
    try { React = require('react') } catch (error) { React = null }

    function MoveUpIcon() {
      return React.createElement('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      },
        React.createElement('path', { d: 'M8 13V3.5' }),
        React.createElement('path', { d: 'M3.5 8L8 3.5 12.5 8' }),
      )
    }

    /** One POST; resolves with the host result or rejects with its message. */
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

    /** Structured backend. `owned()` means another copy of this bundle already
     * registered the row, so the DOM backend must stay off. */
    function installStructured(ctx, callbacks) {
      if (!ctx || typeof ctx.inject !== 'function') return
      ctx.inject(['contextMenus', 'slots'], function (scope) {
        var menus = scope.contextMenus
        if (!menus || typeof menus.register !== 'function') return
        try {
          if (React && scope.slots && typeof scope.slots.inject === 'function') {
            scope.slots.inject('contextMenu.icon', function* () {
              yield scope.slots.register({ name: 'contextMenu.icon', key: ICON_KEY }, MoveUpIcon)
            })
          }
          scope.effect(function () {
            var dispose = menus.register({
              id: 'workspace.move-up',
              target: 'workspace',
              order: 50,
              resolve: function (target) {
                var workspaceId = target && target.workspaceId
                if (typeof workspaceId !== 'string' || workspaceId === '') return []
                var action = {
                  id: 'move-up',
                  label: LABELS.menu,
                  failureLabel: LABELS.failed,
                  run: function () {
                    return moveWorkspace(workspaceId).then(function (result) {
                      if (typeof menus.notify === 'function') {
                        menus.notify(result && result.moved === false ? LABELS.already : LABELS.done, true)
                      }
                    })
                  },
                }
                if (React) action.icon = { key: ICON_KEY }
                return [action]
              },
            })
            callbacks.active()
            return function () { try { dispose() } catch (error) { /* already gone */ } }
          })
        } catch (error) {
          if (/duplicate/i.test(String((error && error.message) || error))) callbacks.owned()
        }
      })
    }

    /** DOM backend: one row for the menu opened by a workspace row, once per open.
     * The observer lives only while a menu is expected. */
    function installDom(offLimits) {
      var armed = null // { id, opener }
      var expiry = null
      var debounce = null
      var observer = null
      var wrappers = new Set()

      function rowOf(element) {
        var row = element && element.closest && element.closest('[data-row-key^="workspace:"]')
        return row && (row.getAttribute('data-row-key') || '').slice('workspace:'.length)
      }

      function disarm() {
        armed = null
        if (expiry !== null) { clearTimeout(expiry); expiry = null }
        if (debounce !== null) { clearTimeout(debounce); debounce = null }
        if (observer) { observer.disconnect(); observer = null }
      }

      function arm(event) {
        var target = event.target
        if (!target || typeof target.closest !== 'function' || target.closest('[role="menu"]')) return
        var button = target.closest('button[aria-label]')
        var row = button && button.closest('[data-row-key^="workspace:"]')
        var own = button && row && !button.hasAttribute('aria-keyshortcuts') && row.querySelector('button[aria-label]') === button
        if (!own) { disarm(); return }
        var id = rowOf(button)
        if (!id) { disarm(); return }
        armed = { id: id, opener: button }
        if (observer) return
        observer = new MutationObserver(schedule)
        observer.observe(document.documentElement, { childList: true, subtree: true })
        // Safety net only: a pending decoration wins over the timeout.
        expiry = setTimeout(function () { if (debounce === null) disarm() }, 1000)
      }

      function run(button, opener) {
        var id = button.dataset.moveUpWorkspaceId
        if (!id) return
        button.disabled = true
        button.title = LABELS.menu
        moveWorkspace(id).then(function () {
          button.title = LABELS.done
          if (opener && opener.isConnected) opener.click()
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        }).catch(function (error) {
          button.disabled = false
          button.title = LABELS.failed + ' ' + (error instanceof Error ? error.message : String(error))
          button.setAttribute('aria-label', button.title)
        })
      }

      function buildRow(menu, template) {
        var opener = armed.opener
        var viewport = menu.querySelector('[role="presentation"]') || menu
        var parent = template.parentElement
        var wrapper = parent ? parent.cloneNode(false) : document.createElement('div')
        var button = template.cloneNode(false)
        button.setAttribute(MARKER, '1')
        button.dataset.moveUpWorkspaceId = armed.id
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
        if (spans[1] || spans[0]) label.className = (spans[1] || spans[0]).className
        label.textContent = LABELS.menu
        button.appendChild(label)
        button.addEventListener('click', function (event) {
          event.preventDefault()
          event.stopPropagation()
          run(event.currentTarget, opener)
        })
        wrapper.appendChild(button)
        viewport.insertBefore(wrapper, viewport.firstChild)
        wrappers.add(wrapper)
      }

      function decorate() {
        if (offLimits() || !armed) return
        // A trigger that reports itself closed cannot own an open menu.
        if (armed.opener.getAttribute('aria-expanded') === 'false') return disarm()
        var menus = document.querySelectorAll('[role="menu"]')
        for (var i = 0; i < menus.length; i++) {
          var menu = menus[i]
          if (menu.querySelector('[' + MARKER + ']') || menu.querySelector('[' + LEGACY_MARKER + ']')) continue
          var template = menu.querySelector('button[role="menuitem"]')
          if (!template) continue
          buildRow(menu, template)
          return disarm()
        }
      }

      function schedule() {
        if (debounce !== null) return
        debounce = setTimeout(function () { debounce = null; decorate() }, 40)
      }

      document.addEventListener('pointerdown', arm, true)

      return function () {
        document.removeEventListener('pointerdown', arm, true)
        disarm()
        wrappers.forEach(function (wrapper) { wrapper.remove() })
        wrappers.clear()
      }
    }

    function apply(ctx) {
      if (INSTALLED.has(ctx)) return
      INSTALLED.add(ctx)
      var state = { structured: false, owned: false }
      var disposers = []
      var domDispose = null
      var domTimer = null

      function startDom() {
        if (domDispose || domTimer !== null || state.structured || state.owned) return
        // Defer one turn: when the structured API exists it registers first and
        // this fallback never builds a listener.
        domTimer = setTimeout(function () {
          domTimer = null
          if (domDispose || state.structured || state.owned) return
          try {
            domDispose = installDom(function () { return state.structured || state.owned })
            disposers.push(domDispose)
          } catch (error) {
            domDispose = null
          }
        }, 0)
      }

      try {
        installStructured(ctx, {
          active: function () {
            state.structured = true
            if (domTimer !== null) { clearTimeout(domTimer); domTimer = null }
            if (!domDispose) return
            var dispose = domDispose
            domDispose = null
            try { dispose() } catch (error) { /* teardown must not throw */ }
          },
          owned: function () { state.owned = true },
        })
      } catch (error) {
        // A capability miss must never break the client entry.
      }
      startDom()

      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () {
            if (domTimer !== null) { clearTimeout(domTimer); domTimer = null }
            disposers.forEach(function (dispose) {
              try { dispose() } catch (error) { /* teardown must not throw */ }
            })
            disposers.length = 0
            domDispose = null
          }
        })
      }
    }

    exports.apply = apply
    exports.labels = pickLabels
    return module.exports
  },
})
