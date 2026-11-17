import type { Context } from '@deepseek-ai/cordis';
import type { MoveUpService } from './service.js';
/** Exact connection route the client calls for a one-shot move. */
export declare const MOVE_ROUTE = "/api/plugins/dsh-move-up/move";
export declare const MOVE_ACTION = "move-to-top";
/** Handle an authenticated request.
 *
 * Business failures are reported as data with a status that tells the client
 * whether the request was wrong (400), the workspace is gone (409), the host
 * cannot do it (501) or the durable write failed (500).
 * @param moveTop serialized service
 * @param request owner authenticated request
 * @returns JSON response
 */
export declare function handleMoveRequest(moveTop: MoveUpService, request: Request): Promise<Response>;
/** Register the optional connection route with an effect disposer.
 *
 * A host that moved or renamed the connection API makes this a no-op instead of
 * a plugin activation failure: the menu item then reports the HTTP error and the
 * rest of the plugin keeps loading.
 * @param ctx plugin context
 * @param moveTop serialized service
 * @returns nothing
 */
export declare function installMoveRoute(ctx: Context, moveTop: MoveUpService): void;
