import { appRouter } from "@reviewer/api";
import { createOpenApiFetchHandler } from "trpc-to-openapi";
import { createTRPCContext } from "../../../../lib/trpc-context";

const handler = (request: Request) =>
  createOpenApiFetchHandler({
    endpoint: "/api/v1",
    req: request,
    router: appRouter,
    createContext: createTRPCContext,
    onError({ error, path }) {
      console.error("OpenAPI request failed", { path, code: error.code });
    },
  });

export { handler as DELETE, handler as GET, handler as PATCH, handler as POST, handler as PUT };
