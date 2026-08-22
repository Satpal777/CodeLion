import { describe, expect, it } from "vitest";
import {
  GEMINI_MODEL_CASCADE,
  resolveGoogleApiKey,
  createGoogleProvider,
  isOpenAICompatibleConfigured,
  resolveOpenAICompatibleModel,
  createOpenAICompatibleProvider,
  executeTextTask,
} from "../src/provider";

describe("Google AI Provider & Gemini Model Cascade", () => {
  it("defines the prioritized model cascade starting from gemini-3.7-flash", () => {
    expect(GEMINI_MODEL_CASCADE).toContain("gemini-3.7-flash");
    expect(GEMINI_MODEL_CASCADE).toContain("gemini-3.6-flash");
    expect(GEMINI_MODEL_CASCADE).toContain("gemini-3.6");
    expect(GEMINI_MODEL_CASCADE[0]).toBe("gemini-3.7-flash");
    expect(GEMINI_MODEL_CASCADE[1]).toBe("gemini-3.6-flash");
    expect(GEMINI_MODEL_CASCADE[2]).toBe("gemini-3.6");
  });

  it("resolves google api key with precedence", () => {
    expect(resolveGoogleApiKey("custom-gemini-key")).toBe("custom-gemini-key");
  });

  it("creates Google provider instance", () => {
    const provider = createGoogleProvider("test-gemini-key");
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("function");
  });
});

describe("OpenAI-Compatible Provider Integration", () => {
  it("detects configuration status", () => {
    const configured = isOpenAICompatibleConfigured();
    expect(typeof configured).toBe("boolean");
  });

  it("resolves OpenAI model name", () => {
    const model = resolveOpenAICompatibleModel();
    expect(typeof model).toBe("string");
  });

  it("creates OpenAI-compatible provider instance", () => {
    const provider = createOpenAICompatibleProvider();
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("function");
  });

  it("executes OpenAI-compatible model task if configured", async () => {
    if (!isOpenAICompatibleConfigured()) {
      console.log("OpenAI-compatible environment variables not set; skipping live endpoint test.");
      return;
    }
    const result = await executeTextTask({
      prompt: "Respond with the word 'PONG'",
      useOpenAICompatible: true,
    });
    expect(result.output).toBeDefined();
    expect(result.modelUsed).toBeDefined();
  }, 15_000);

  it("executes OpenAI-compatible structured task if configured", async () => {
    if (!isOpenAICompatibleConfigured()) return;
    const { z } = await import("zod");
    const { executeStructuredTask } = await import("../src/provider");
    const result = await executeStructuredTask({
      prompt: "Extract status and count: status is active, count is 42",
      schema: z.object({
        status: z.string(),
        count: z.number(),
      }),
      useOpenAICompatible: true,
    });
    expect(result.output).toBeDefined();
    expect(result.output.status).toBe("active");
    expect(result.output.count).toBe(42);
    expect(result.modelUsed).toBeDefined();
  }, 15_000);
});


