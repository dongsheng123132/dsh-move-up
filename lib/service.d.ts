import { Service, type Context } from '@deepseek-ai/cordis';
export declare const SERVICE_NAME = "moveUpWorkspace";
declare module '@deepseek-ai/cordis' {
    interface Context {
        moveUpWorkspace: MoveUpService;
    }
}
/** Registry projection needed for ordering and the route payload. */
export interface WorkspaceEntryView {
    readonly id: string;
    readonly path: string;
    readonly title: string;
}
/** One successful move-to-top result. */
export interface MoveToTopResult {
    readonly ok: true;
    /** Whether an `insertBefore` actually moved the workspace. */
    readonly moved: boolean;
    /** The complete durable order after the operation (top first). */
    readonly order: readonly string[];
    readonly workspaces: readonly WorkspaceEntryView[];
}
/** Why a move could not be performed. */
export type MoveToTopFailure = 'none' | 'unsupported-host' | 'write-failed';
/** Failure result for an empty registry, an unknown workspace, a host whose
 * registry API is missing, or a rejected durable write. */
export interface MoveToTopError {
    readonly ok: false;
    readonly reason: MoveToTopFailure;
    readonly message: string;
}
/** Stateless "move to top" service. Owns the registry ordering queue but no
 * file or saved state: it never reorders on activation and keeps no ordering
 * or favorites state. */
export declare class MoveUpService extends Service {
    private queue;
    constructor(ctx: Context);
    private enqueue;
    private registry;
    private list;
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
    moveToTop(workspaceId: string): Promise<MoveToTopResult | MoveToTopError>;
}
