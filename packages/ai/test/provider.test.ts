import { describe, expect, it } from "vitest";
import {
  GEMINI_MODEL_CASCADE,
  resolveGoogleApiKey,
  createGoogleProvider,
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
