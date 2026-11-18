import { Service } from '@deepseek-ai/cordis';
export const SERVICE_NAME = 'moveUpWorkspace';
function toEntryView(entry) {
    return { id: String(entry.id), path: typeof entry.path === 'string' ? entry.path : '', title: typeof entry.title === 'string' ? entry.title : '' };
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Stateless "move to top" service. Owns the registry ordering queue but no
 * file or saved state: it never reorders on activation and keeps no ordering
 * or favorites state. */
export class MoveUpService extends Service {
    queue = Promise.resolve();
    constructor(ctx) {
        super(ctx, SERVICE_NAME);
    }
    enqueue(action) {
        const run = this.queue.then(action);
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }
    registry() {
        return this.ctx.workspaceRegistry;
    }
    list(registry) {
        return registry.list().map(toEntryView);
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
    moveToTop(workspaceId) {
        return this.enqueue(async () => {
            const registry = this.registry();
            if (!registry || typeof registry.list !== 'function') {
                return { ok: false, reason: 'unsupported-host', message: '当前 DSH 版本没有工作区注册表，请升级 Move Up 插件' };
            }
            if (typeof registry.insertBefore !== 'function') {
                return { ok: false, reason: 'unsupported-host', message: '当前 DSH 版本不支持调整工作区顺序，请升级 Move Up 插件' };
            }
            let order;
            try {
                order = this.list(registry);
            }
            catch (error) {
                return { ok: false, reason: 'write-failed', message: `读取工作区顺序失败：${messageOf(error)}` };
            }
            const first = order[0];
            if (first === undefined)
                return { ok: false, reason: 'none', message: '工作区列表为空' };
            const ids = order.map(entry => entry.id);
            if (first.id === workspaceId)
                return { ok: true, moved: false, order: ids };
            if (!ids.includes(workspaceId))
                return { ok: false, reason: 'none', message: '工作区已不存在，请刷新列表' };
            try {
                // The write already succeeded, so read-back failures are not "not written".
                const next = await registry.insertBefore(workspaceId, first.id);
                return { ok: true, moved: true, order: (next ?? []).map(id => String(id)) };
            }
            catch (error) {
                return { ok: false, reason: 'write-failed', message: `顺序没有写入：${messageOf(error)}` };
            }
        });
    }
}
