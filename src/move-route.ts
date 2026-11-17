import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { MoveUpService } from './service.js'

/** Exact connection route the client calls for a one-shot move. */
export const MOVE_ROUTE = '/api/plugins/dsh-move-up/move'
export const MOVE_ACTION = 'move-to-top'

/** Handle an authenticated request.
 *
 * Business failures are reported as data with a status that tells the client
 * whether the request was wrong (400), the workspace is gone (409), the host
 * cannot do it (501) or the durable write failed (500).
 * @param moveTop serialized service
 * @param request owner authenticated request
 * @returns JSON response
 */
export async function handleMoveRequest(moveTop: MoveUpService, request: Request): Promise<Response> {
  const headers = { 'cache-control': 'no-store' }
  try {
    if (request.method !== 'POST') return Response.json({ ok: false, message: '不支持的请求方式' }, { status: 405, headers })
    let body: unknown
    try { body = await request.json() } catch { return Response.json({ ok: false, message: '请求不是合法 JSON' }, { status: 400, headers }) }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('workspaceId' in body) || typeof body.workspaceId !== 'string' || !body.workspaceId.trim() || !('action' in body) || body.action !== MOVE_ACTION) {
      return Response.json({ ok: false, message: `需要工作区 ID 与 action: '${MOVE_ACTION}'` }, { status: 400, headers })
    }
    const result = await moveTop.moveToTop(body.workspaceId)
    const status = result.ok ? 200 : result.reason === 'unsupported-host' ? 501 : result.reason === 'none' ? 409 : 500
    return Response.json(result, { status, headers })
  } catch { return Response.json({ ok: false, message: '移动未完成，请刷新后重试' }, { status: 500, headers }) }
}

/** Register the optional connection route with an effect disposer.
 *
 * A host that moved or renamed the connection API makes this a no-op instead of
 * a plugin activation failure: the menu item then reports the HTTP error and the
 * rest of the plugin keeps loading.
 * @param ctx plugin context
 * @param moveTop serialized service
 * @returns nothing
 */
export function installMoveRoute(ctx: Context, moveTop: MoveUpService): void {
  try {
    ctx.inject(['connection'], scope => {
      scope.effect(() => scope.connection.fetch.register({ path: MOVE_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: request => handleMoveRequest(moveTop, request) }))
    })
  } catch (error) {
    console.warn('[dsh-move-up] could not register its route on this DSH version:', error instanceof Error ? error.message : error)
  }
}
