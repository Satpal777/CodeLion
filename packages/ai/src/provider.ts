import "dotenv/config";
import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
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

export function resolveOpenAIApiKey(customKey?: string): string {
  const key =
    customKey ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_GATEWAY_API_KEY ||
    "";
  return key.trim();
}

export function openAICompatibleBaseUrl(): string {
  return process.env.OPENAI_API_BASE_URL || process.env.AI_GATEWAY_API_BASE_URL || "https://api.openai.com/v1";
}

export function createGoogleProvider(apiKey?: string): GoogleGenerativeAIProvider {
  const key = resolveGoogleApiKey(apiKey);
  return createGoogleGenerativeAI({
    apiKey: key || "dev-placeholder-gemini-key",
  });
}

export function createOpenAIProvider(apiKey?: string): OpenAIProvider {
  const baseUrl = openAICompatibleBaseUrl();
  const key = resolveOpenAIApiKey(apiKey);
  const customObj: Record<string, unknown> = {};
  baseUrl && (customObj["baseUrl"] = baseUrl);
  key && (customObj["apiKey"] = key);
  return createOpenAI(customObj);
}

// ---------------------------------------------------------------------------
// OpenAI-Compatible provider helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when all three OpenAI-compatible env vars are present.
 * Used to conditionally show the provider switch in the UI.
 */
export function isOpenAICompatibleConfigured(): boolean {
  const baseUrl = (process.env.OPENAI_COMPATIBLE_BASE_URL ?? "").trim();
  const apiKey = (process.env.OPENAI_COMPATIBLE_API_KEY ?? "").trim();
  const model = (process.env.OPENAI_COMPATIBLE_MODEL ?? "").trim();
  return Boolean(baseUrl && apiKey && model);
}

/**
 * Resolves the OpenAI-compatible model name from env.
 */
export function resolveOpenAICompatibleModel(): string {
  return (process.env.OPENAI_COMPATIBLE_MODEL ?? "").trim();
}

/**
 * Creates an OpenAI-SDK provider pointed at the custom base URL and API key.
 */
export function createOpenAICompatibleProvider(): OpenAIProvider {
  const baseUrl = (process.env.OPENAI_COMPATIBLE_BASE_URL ?? "").trim();
  const apiKey = (process.env.OPENAI_COMPATIBLE_API_KEY ?? "").trim();
  return createOpenAI({
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    apiKey: apiKey || "placeholder",
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

// ---------------------------------------------------------------------------
// Provider-agnostic execution: OpenAI-compatible first → Gemini cascade
// ---------------------------------------------------------------------------

export interface GenericExecutionOptions<TSchema extends z.ZodTypeAny>
  extends ModelExecutionOptions<TSchema> {
  /** When true (and OPENAI_COMPATIBLE_* env vars are set), try the OpenAI-compatible model first. */
  useOpenAICompatible?: boolean;
}

/**
 * Structured task: tries the OpenAI-compatible model first when requested and
 * configured, then falls back to the full Gemini cascade.
 */
export async function executeStructuredTask<TSchema extends z.ZodTypeAny>(
  options: GenericExecutionOptions<TSchema>,
): Promise<ModelExecutionResult<z.infer<TSchema>>> {
  if (options.useOpenAICompatible && isOpenAICompatibleConfigured()) {
    const modelName = resolveOpenAICompatibleModel();
    try {
      const provider = createOpenAICompatibleProvider();
      const modelInstance = provider(modelName);

      if (options.schema) {
        const result = await generateText({
          model: modelInstance,
          output: Output.object({ schema: options.schema }),
          ...(options.system ? { system: options.system } : {}),
          prompt: options.prompt,
          temperature: options.temperature ?? 0.2,
        });
        return { output: result.output as z.infer<TSchema>, modelUsed: modelName, fallbackCount: 0 };
      } else {
        const result = await generateText({
          model: modelInstance,
          ...(options.system ? { system: options.system } : {}),
          prompt: options.prompt,
          temperature: options.temperature ?? 0.2,
        });
        return { output: result.text as z.infer<TSchema>, modelUsed: modelName, fallbackCount: 0 };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[OpenAI-Compatible] Model '${modelName}' failed (${message}). Falling back to Gemini cascade...`,
      );
    }
  }

  // Gemini cascade fallback
  return executeStructuredGeminiTask(options);
}

/**
 * Text task: tries the OpenAI-compatible model first when requested and
 * configured, then falls back to the full Gemini cascade.
 */
export async function executeTextTask(
  options: Omit<GenericExecutionOptions<any>, "schema">,
): Promise<ModelExecutionResult<string>> {
  if (options.useOpenAICompatible && isOpenAICompatibleConfigured()) {
    const modelName = resolveOpenAICompatibleModel();
    try {
      const provider = createOpenAICompatibleProvider();
      const modelInstance = provider(modelName);
      const result = await generateText({
        model: modelInstance,
        ...(options.system ? { system: options.system } : {}),
        prompt: options.prompt,
        temperature: options.temperature ?? 0.2,
      });
      return { output: result.text, modelUsed: modelName, fallbackCount: 0 };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[OpenAI-Compatible] Model '${modelName}' failed (${message}). Falling back to Gemini cascade...`,
      );
    }
  }

  // Gemini cascade fallback
  return executeTextGeminiTask(options);
}

