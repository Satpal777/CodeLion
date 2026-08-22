/**
 * Thin OpenTelemetry helper for AI SDK calls.
 *
 * Wraps executions in an OTel span carrying GenAI semantic-convention
 * attributes so Inngest's `extendedTracesMiddleware` can promote them to
 * "AI metadata" panels in the dashboard trace waterfall.
 *
 * Attributes set:  gen_ai.system · gen_ai.request.model
 *                  gen_ai.usage.input_tokens · gen_ai.usage.output_tokens
 *                  gen_ai.response.model · reviewer.operation · reviewer.fallback_count
 *
 * If no OTel SDK is registered the helper is a transparent pass-through.
 */
import * as otelApi from "@opentelemetry/api";

/** Semantic convention attribute names (GenAI 1.x). */
const Attrs = {
  SYSTEM:          "gen_ai.system",
  REQUEST_MODEL:   "gen_ai.request.model",
  RESPONSE_MODEL:  "gen_ai.response.model",
  INPUT_TOKENS:    "gen_ai.usage.input_tokens",
  OUTPUT_TOKENS:   "gen_ai.usage.output_tokens",
  OPERATION:       "reviewer.operation",
  FALLBACK_COUNT:  "reviewer.fallback_count",
  PROVIDER:        "reviewer.provider",
} as const;

export interface OtelSpanOptions {
  /** Operation name shown in the trace (e.g. "review", "chat"). */
  operation: string;
  /** Requested model name. */
  model: string;
  /** Provider label — "google-gemini" | "openai-compatible". */
  provider?: string;
}

export interface OtelSpanResult {
  /** Actual model that answered (may differ after fallback). */
  modelUsed: string;
  promptTokens?: number;
  completionTokens?: number;
  fallbackCount?: number;
}

/**
 * Wraps an AI SDK call in an OTel span and attaches GenAI attributes.
 * The span is named `"gen_ai <operation>"` to match Inngest's AI extraction
 * heuristic.
 */
export async function withAISpan<T>(
  opts: OtelSpanOptions,
  fn: (span: otelApi.Span) => Promise<T & OtelSpanResult>,
): Promise<T & OtelSpanResult> {
  const tracer = otelApi.trace.getTracer("@reviewer/ai", "0.1.0");
  const spanName = `gen_ai ${opts.operation}`;

  return tracer.startActiveSpan(
    spanName,
    { kind: otelApi.SpanKind.CLIENT },
    async (span) => {
      span.setAttribute(Attrs.SYSTEM,        opts.provider ?? "google-gemini");
      span.setAttribute(Attrs.REQUEST_MODEL, opts.model);
      span.setAttribute(Attrs.OPERATION,     opts.operation);
      if (opts.provider) span.setAttribute(Attrs.PROVIDER, opts.provider);

      try {
        const result = await fn(span);

        // Attach response attributes once the call completes
        span.setAttribute(Attrs.RESPONSE_MODEL,  result.modelUsed);
        span.setAttribute(Attrs.FALLBACK_COUNT,   result.fallbackCount ?? 0);
        if (result.promptTokens !== undefined)
          span.setAttribute(Attrs.INPUT_TOKENS,   result.promptTokens);
        if (result.completionTokens !== undefined)
          span.setAttribute(Attrs.OUTPUT_TOKENS,  result.completionTokens);

        span.setStatus({ code: otelApi.SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({
          code: otelApi.SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Records custom key-value metadata on the current active span.
 * Safe to call even when no span is active.
 */
export function recordSpanAttributes(attrs: Record<string, string | number | boolean>): void {
  const span = otelApi.trace.getActiveSpan();
  if (!span) return;
  for (const [key, value] of Object.entries(attrs)) {
    span.setAttribute(key, value);
  }
}
