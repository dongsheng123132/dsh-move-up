import { Service, type Context } from '@deepseek-ai/cordis'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

export const SERVICE_NAME = 'moveUpWorkspace'
declare module '@deepseek-ai/cordis' {
  interface Context { moveUpWorkspace: MoveUpService }
}

/** Registry projection needed for ordering and the route payload. */
export interface WorkspaceEntryView {
  readonly id: string
  readonly path: string
  readonly title: string
}

/** One successful move-to-top result. */
export interface MoveToTopResult {
  readonly ok: true
  /** Whether an `insertBefore` actually moved the workspace. */
  readonly moved: boolean
  /** The complete durable order after the operation (top first). */
  readonly order: readonly string[]
  readonly workspaces: readonly WorkspaceEntryView[]
}

/** Why a move could not be performed. */
export type MoveToTopFailure = 'none' | 'unsupported-host' | 'write-failed'

/** Failure result for an empty registry, an unknown workspace, a host whose
 * registry API is missing, or a rejected durable write. */
export interface MoveToTopError {
  readonly ok: false
  readonly reason: MoveToTopFailure
  readonly message: string
}

/** The slice of the host registry this plugin uses. Declared structurally so a
 * host that renames or drops a method is detected at call time instead of
 * crashing the plugin on import. */
interface RegistryLike {
  list(): readonly { readonly id: unknown; readonly path?: unknown; readonly title?: unknown }[]
  insertBefore?(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>
}

function toEntryView(entry: { readonly id: unknown; readonly path?: unknown; readonly title?: unknown }): WorkspaceEntryView {
  return { id: String(entry.id), path: typeof entry.path === 'string' ? entry.path : '', title: typeof entry.title === 'string' ? entry.title : '' }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Stateless "move to top" service. Owns the registry ordering queue but no
 * file or saved state: it never reorders on activation and keeps no ordering
 * or favorites state. */
export class MoveUpService extends Service {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(ctx: Context) {
    super(ctx, SERVICE_NAME)
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const run = this.queue.then(action)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }
  private registry(): RegistryLike | undefined {
    return this.ctx.workspaceRegistry as unknown as RegistryLike | undefined
  }
  private list(registry: RegistryLike): readonly WorkspaceEntryView[] {
    return registry.list().map(toEntryView)
  }
  /** Move one workspace to the top of the durable display order, exactly once.
   *
   * Reads the real registry order; an already-first workspace is a no-op and an
   * unknown workspace is rejected without touching the order. Otherwise it asks
   * the host for `insertBefore(id, firstId)` — the same durable write the
   * official sidebar drag uses — so the result survives restart and no plugin
   * startup pass re-applies it.
   *
   * Every host capability is checked at call time and reported as data, so a
   * host upgrade that renames or drops the registry write surfaces as a clear
   * message instead of an unhandled plugin error.
   * @param workspaceId exact registry ID
   */
  moveToTop(workspaceId: string): Promise<MoveToTopResult | MoveToTopError> {
    return this.enqueue(async () => {
      const registry = this.registry()
      if (!registry || typeof registry.list !== 'function') {
        return { ok: false, reason: 'unsupported-host', message: '当前 DSH 版本没有工作区注册表，请升级 Move Up 插件' }
      }
      if (typeof registry.insertBefore !== 'function') {
        return { ok: false, reason: 'unsupported-host', message: '当前 DSH 版本不支持调整工作区顺序，请升级 Move Up 插件' }
      }
      let order: readonly WorkspaceEntryView[]
      try {
        order = this.list(registry)
      } catch (error) {
        return { ok: false, reason: 'write-failed', message: `读取工作区顺序失败：${messageOf(error)}` }
      }
      const first = order[0]
      if (first === undefined) return { ok: false, reason: 'none', message: '工作区列表为空' }
      if (first.id === workspaceId) {
        return { ok: true, moved: false, order: order.map(entry => entry.id), workspaces: order }
      }
      if (!order.some(entry => entry.id === workspaceId)) {
        return { ok: false, reason: 'none', message: '工作区已不存在，请刷新列表' }
      }
      try {
        const next = await registry.insertBefore(workspaceId as WorkspaceId, first.id as WorkspaceId)
        return { ok: true, moved: true, order: (next ?? []).map(id => String(id)), workspaces: this.list(registry) }
      } catch (error) {
        return { ok: false, reason: 'write-failed', message: `顺序没有写入：${messageOf(error)}` }
      }
    })
  }
}
