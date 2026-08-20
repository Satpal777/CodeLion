import "dotenv/config";
import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";

export const GEMINI_MODEL_CASCADE = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.6",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
] as const;

export type GeminiModelName = (typeof GEMINI_MODEL_CASCADE)[number] | string;

export function resolveGoogleApiKey(customKey?: string): string {
  const key =
    customKey ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.AI_GATEWAY_API_KEY ||
    "";
  return key.trim();
}

export function createGoogleProvider(apiKey?: string): GoogleGenerativeAIProvider {
  const key = resolveGoogleApiKey(apiKey);
  return createGoogleGenerativeAI({
    apiKey: key || "dev-placeholder-gemini-key",
  });
}

export interface ModelExecutionOptions<TSchema extends z.ZodTypeAny> {
  system?: string;
  prompt: string;
  schema?: TSchema;
  models?: readonly string[] | string[];
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelExecutionResult<T> {
  output: T;
  modelUsed: string;
  fallbackCount: number;
}

/**
 * Executes a structured AI task using Vercel AI SDK Google provider.
 * Iterates through the hierarchy of Gemini models (starting from gemini-3.7-flash down to lower models).
 * If a model fails (e.g. 404 unsupported, quota, rate limit, server error), it falls back to the next model in the list.
 */
export async function executeStructuredGeminiTask<TSchema extends z.ZodTypeAny>(
  options: ModelExecutionOptions<TSchema>,
): Promise<ModelExecutionResult<z.infer<TSchema>>> {
  const modelsToTry = (options.models && options.models.length > 0)
    ? options.models
    : GEMINI_MODEL_CASCADE;

  const google = createGoogleProvider(options.apiKey);
  const errors: Array<{ model: string; error: unknown }> = [];

  for (let i = 0; i < modelsToTry.length; i += 1) {
    const modelName = modelsToTry[i]!;
    try {
      const modelInstance = google(modelName as any);

      if (options.schema) {
        const result = await generateText({
          model: modelInstance,
          output: Output.object({ schema: options.schema }),
          ...(options.system ? { system: options.system } : {}),
          prompt: options.prompt,
          temperature: options.temperature ?? 0.2,
        });

        return {
          output: result.output as z.infer<TSchema>,
          modelUsed: modelName,
          fallbackCount: i,
        };
      } else {
        const result = await generateText({
          model: modelInstance,
          ...(options.system ? { system: options.system } : {}),
          prompt: options.prompt,
          temperature: options.temperature ?? 0.2,
        });

        return {
          output: result.text as z.infer<TSchema>,
          modelUsed: modelName,
          fallbackCount: i,
        };
      }
    } catch (err: unknown) {
      errors.push({ model: modelName, error: err });
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Gemini Fallback] Model '${modelName}' failed (${message}). Falling back to next model...`,
      );
    }
  }

  const errorDetails = errors
    .map((e) => `[${e.model}]: ${e.error instanceof Error ? e.error.message : String(e.error)}`)
    .join("\n");
  throw new Error(`All Gemini models in fallback cascade failed:\n${errorDetails}`);
}

/**
 * Text generation with model fallback cascade.
 */
export async function executeTextGeminiTask(
  options: Omit<ModelExecutionOptions<any>, "schema">,
): Promise<ModelExecutionResult<string>> {
  const modelsToTry = (options.models && options.models.length > 0)
    ? options.models
    : GEMINI_MODEL_CASCADE;

  const google = createGoogleProvider(options.apiKey);
  const errors: Array<{ model: string; error: unknown }> = [];

  for (let i = 0; i < modelsToTry.length; i += 1) {
    const modelName = modelsToTry[i]!;
    try {
      const modelInstance = google(modelName as any);
      const result = await generateText({
        model: modelInstance,
        ...(options.system ? { system: options.system } : {}),
        prompt: options.prompt,
        temperature: options.temperature ?? 0.2,
      });

      return {
        output: result.text,
        modelUsed: modelName,
        fallbackCount: i,
      };
    } catch (err: unknown) {
      errors.push({ model: modelName, error: err });
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Gemini Fallback] Model '${modelName}' failed (${message}). Falling back to next model...`,
      );
    }
  }

  const errorDetails = errors
    .map((e) => `[${e.model}]: ${e.error instanceof Error ? e.error.message : String(e.error)}`)
    .join("\n");
  throw new Error(`All Gemini models in fallback cascade failed:\n${errorDetails}`);
}
