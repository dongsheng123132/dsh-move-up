import { MoveUpService } from './service.js';
import { installMoveRoute } from './move-route.js';
export const name = 'move-up';
export const inject = ['workspaceRegistry'];
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
export async function apply(ctx) {
    const moveTop = new MoveUpService(ctx);
    installMoveRoute(ctx, moveTop);
}
