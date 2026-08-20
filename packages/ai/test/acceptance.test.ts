import { describe, expect, it } from "vitest";
import { evaluateSuggestionAccepted } from "../src/acceptance";

describe("evaluateSuggestionAccepted", () => {
  it("detects when a suggested code change was applied in a git patch", () => {
    const suggestion = {
      findingId: "f-1",
      reviewRunId: "run-1",
      path: "src/utils.ts",
      line: 42,
      title: "Use strict equality check",
      suggestedPatch: "if (user.role === 'admin') {\n  return true;\n}",
    };

    const filePatch = `@@ -40,4 +40,4 @@
-if (user.role == 'admin') {
+if (user.role === 'admin') {
+  return true;
+}`;

    const result = evaluateSuggestionAccepted(suggestion, filePatch);
    expect(result.accepted).toBe(true);
  });

  it("rejects when the patch does not match the suggestion", () => {
    const suggestion = {
      findingId: "f-2",
      reviewRunId: "run-1",
      path: "src/utils.ts",
      line: 10,
      title: "Add error handling",
      suggestedPatch: "try {\n  await doSomething();\n} catch (err) {\n  logger.error(err);\n}",
    };

    const filePatch = `@@ -10,1 +10,1 @@
-console.log('test')
+console.info('test')`;

    const result = evaluateSuggestionAccepted(suggestion, filePatch);
    expect(result.accepted).toBe(false);
  });

  it("handles missing patch or empty suggestions safely", () => {
    const suggestion = {
      findingId: "f-3",
      reviewRunId: "run-1",
      path: "src/utils.ts",
      line: null,
      title: "Missing patch",
      suggestedPatch: null,
    };

    expect(evaluateSuggestionAccepted(suggestion, null).accepted).toBe(false);
  });
});
