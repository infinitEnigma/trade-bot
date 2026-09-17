/** GET /api/market/ws-url — WebSocket URL for a verified Kodiak account. */
import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth.middleware";
import { errMessage, fail, ok, WS_BASE } from "./market-helpers";
import { requireVerifiedCredentials } from "./market-cache";

export const wsUrlRoutes = Router();

wsUrlRoutes.get(
    "/ws-url",
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const gate = await requireVerifiedCredentials(req.user?.userId, res);
            if (!gate?.accountId) {
                // `requireVerifiedCredentials` already sent a 401/403 when it
                // returns null; a verified row without an account id cannot
                // produce a URL, so treat it as "credentials required".
                if (gate) {
                    return res
                        .status(403)
                        .json({ success: false, error: "Kodiak credentials required" });
                }
                return;
            }
            ok(res, {
                publicWsUrl: `${WS_BASE}/${gate.accountId}`,
                timestamp: Date.now(),
            });
        } catch (err: unknown) {
            fail(res, "ws_url_endpoint", "Failed to get WebSocket URL", {
                userId: req.user?.userId,
                error: errMessage(err),
            });
        }
    }
);
