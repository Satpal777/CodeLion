import { appRouter } from "@reviewer/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createTRPCContext } from "../../../../lib/trpc-context";

function handler(request: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: createTRPCContext,
    onError({ error, path }) {
      console.error("tRPC request failed", { path, code: error.code });
    },
  });
}

export { handler as GET, handler as POST };
