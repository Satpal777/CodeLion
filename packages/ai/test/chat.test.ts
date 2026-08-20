import { describe, expect, it } from "vitest";
import {
  extractFeedbackCandidateFromChat,
  formatChatReply,
  isAuthorizedForAction,
  parseChatIntent,
} from "../src/chat";

describe("PR Chat and Feedback Engine", () => {
  it("parses fix intent with destination detection", () => {
    const fixStacked = parseChatIntent("@bot fix this finding and open a draft PR");
    expect(fixStacked.type).toBe("fix");
    if (fixStacked.type === "fix") {
      expect(fixStacked.destination).toBe("stacked_pr");
    }

    const fixBranch = parseChatIntent("@bot fix and update this PR directly");
    expect(fixBranch.type).toBe("fix");
    if (fixBranch.type === "fix") {
      expect(fixBranch.destination).toBe("existing_branch");
    }
  });

  it("parses review requests and explanations", () => {
    const reviewIntent = parseChatIntent("@bot full review");
    expect(reviewIntent.type).toBe("review");

    const explainIntent = parseChatIntent("@bot why is this finding high severity?");
    expect(explainIntent.type).toBe("explain");
  });

  it("enforces actor authorization permissions", () => {
    expect(isAuthorizedForAction("OWNER", "fix")).toBe(true);
    expect(isAuthorizedForAction("COLLABORATOR", "fix")).toBe(true);
    expect(isAuthorizedForAction("NONE", "fix")).toBe(false);
    expect(isAuthorizedForAction("CONTRIBUTOR", "general_question")).toBe(true);
  });

  it("extracts scoped feedback candidates from chat comments", () => {
    const candidate = extractFeedbackCandidateFromChat(
      "@bot remember: do not flag deliberate exhaustive switches in generated protocol adapters",
      "OWNER",
    );
    expect(candidate).toBeDefined();
    expect(candidate?.promotable).toBe(true);
  });

  it("formats chat response with evidence citations", () => {
    const formatted = formatChatReply(
      "The missing null check was found.",
      ["src/auth.ts@head#L10-L15"],
      "Draft fix PR created.",
    );
    expect(formatted).toContain("**Evidence cited:**");
    expect(formatted).toContain("src/auth.ts@head#L10-L15");
    expect(formatted).toContain("Draft fix PR created.");
  });
});
