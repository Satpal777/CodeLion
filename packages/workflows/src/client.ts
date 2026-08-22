import "dotenv/config";
import { Inngest } from "inngest";
import { extendedTracesMiddleware } from "inngest/experimental";

/**
 * Inngest client with extended OpenTelemetry trace support.
 *
 * `extendedTracesMiddleware` propagates every OTel span created inside
 * `step.run` blocks (AI SDK, DB, custom) into the Inngest dashboard trace
 * waterfall, giving full visibility at each workflow step.
 *
 * AI SDK spans carrying `gen_ai.*` semantic-convention attributes are
 * automatically promoted to "AI metadata" panels in the Inngest UI.
 */
export const inngest: Inngest = new Inngest({
  id: "self-learning-reviewer",
  isDev: process.env.INNGEST_DEV === "1" || process.env.INNGEST_DEV === "true",
  middleware: [extendedTracesMiddleware() as any],
});
