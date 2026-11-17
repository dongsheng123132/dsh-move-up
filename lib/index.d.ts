import type { Context } from '@deepseek-ai/cordis';
export declare const name = "move-up";
export declare const inject: string[];
export { MoveUpService, SERVICE_NAME } from './service.js';
export { MOVE_ROUTE, MOVE_ACTION, handleMoveRequest } from './move-route.js';
/** Activate the stateless move-to-top service. No startup reordering: the
 * host's durable registry order is left untouched until a client asks to move
 * one workspace to the top.
 *
 * The service itself stays capability-checked at call time, so a host upgrade
 * degrades into clear error messages rather than a broken activation.
 * @param ctx injected plugin scope
 */
export declare function apply(ctx: Context): Promise<void>;
