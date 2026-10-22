import { TRPCError } from "@trpc/server";
import { getNetatmoOAuthToken } from "../db";
import { startNetatmoAuthorization } from "../netatmoOAuth";
import { protectedProcedure, router } from "../_core/trpc";

export const netatmoRouter = router({
  connectionStatus: protectedProcedure.query(async ({ ctx }) => {
    const connection = await getNetatmoOAuthToken(ctx.user.id);
    return {
      connected: Boolean(connection),
      connectedAt: connection?.connectedAt ?? null,
      scopes: connection?.scopes ?? null,
    };
  }),
  startAuthorization: protectedProcedure.mutation(async ({ ctx }) => {
    if (!process.env.NETATMO_CLIENT_ID || !process.env.NETATMO_CLIENT_SECRET) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Identifiants Netatmo manquants" });
    }
    return { authorizationUrl: await startNetatmoAuthorization(ctx.user.id) };
  }),
});
