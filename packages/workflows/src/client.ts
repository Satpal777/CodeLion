import "dotenv/config";
import { Inngest } from "inngest";
import { extendedTracesMiddleware } from "inngest/experimental";

/**
 * Inngest client with extended OpenTelemetry trace support.
 *
 * `behaviour: "extendProvider"` instructs Inngest to extend the active OpenTelemetry
 * provider rather than creating a fallback provider, silencing the deprecation warning.
 */
export const inngest: Inngest = new Inngest({
  id: "self-learning-reviewer",
  isDev: process.env.INNGEST_DEV === "1" || process.env.INNGEST_DEV === "true",
  middleware: [
    extendedTracesMiddleware({
      behaviour: "extendProvider",
    }) as any,
  ],
});
