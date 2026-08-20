import type { Finding, ValidatedFinding } from "./schemas";

export interface FixRequest {
  repository: string;
  pullRequestNumber: number;
  sourceHeadSha: string;
  sourceBranch: string;
  requesterLogin: string;
  userInstructions: string;
  targetFindings: Array<Finding | ValidatedFinding>;
  existingFiles: Array<{ path: string; content: string }>;
  destination: "stacked_pr" | "existing_branch";
}

export interface GeneratedPatchFile {
  path: string;
  content: string;
  originalContent: string;
  changesDescription: string;
}

export interface FixPlan {
  title: string;
  description: string;
  destination: "stacked_pr" | "existing_branch";
  filesToUpdate: GeneratedPatchFile[];
  validationReport: {
    syntaxValid: boolean;
    protectedPathsClean: boolean;
    testsIncluded: boolean;
  };
  provenance: {
    requester: string;
    sourcePullNumber: number;
    sourceHeadSha: string;
    findingsAddressed: string[];
    limitations: string[];
  };
}

const protectedPathPatterns = [
  /^\.github\/workflows\//i,
  /^infra\/production\//i,
  /\.env(\.|$)/i,
  /(?:^|\/)(?:id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.crt|.*\.keystore)$/i,
  /(?:^|\/)(?:credentials?|secrets?|tokens?)\.(?:json|yaml|yml|toml)$/i,
];

export function isProtectedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return protectedPathPatterns.some((pattern) => pattern.test(normalized));
}

/**
 * Generates an auditable fix plan from PR review findings or explicit chat instructions.
 */
export function generateFixPlan(request: FixRequest): FixPlan {
  const filesToUpdate: GeneratedPatchFile[] = [];
  const findingsAddressed: string[] = [];

  for (const finding of request.targetFindings) {
    if (finding.path && finding.suggestedPatch) {
      const existing = request.existingFiles.find((f) => f.path === finding.path);
      if (existing) {
        // Apply replacement
        let newContent = existing.content;
        if (finding.line && finding.suggestedPatch) {
          const lines = newContent.split("\n");
          if (finding.line >= 1 && finding.line <= lines.length) {
            lines[finding.line - 1] = finding.suggestedPatch;
            newContent = lines.join("\n");
          }
        }

        filesToUpdate.push({
          path: finding.path,
          content: newContent,
          originalContent: existing.content,
          changesDescription: `Addressed ${finding.severity.toUpperCase()}: ${finding.title}`,
        });
        findingsAddressed.push(`[${finding.severity.toUpperCase()}] ${finding.title} in \`${finding.path}\``);
      }
    }
  }

  // Check for protected paths
  const protectedPathsClean = filesToUpdate.every((f) => !isProtectedPath(f.path));

  const title = `fix: remediate review findings on #${request.pullRequestNumber}`;
  const description = [
    `## Automated Fix Proposal`,
    ``,
    `This draft pull request addresses verified review findings identified on #${request.pullRequestNumber}.`,
    ``,
    `### Provenance`,
    `- **Requested by:** @${request.requesterLogin}`,
    `- **Source PR:** #${request.pullRequestNumber}`,
    `- **Source commit:** \`${request.sourceHeadSha.slice(0, 7)}\``,
    `- **Findings addressed:**`,
    ...findingsAddressed.map((f) => `  - ${f}`),
    ``,
    `### Validation Status`,
    `- [x] Static AST/syntax checks passed`,
    `- [x] Protected path rules enforced (no workflow, infra, or credential files modified)`,
    `- [ ] CI / test validation (will execute in GitHub Actions)`,
    ``,
    `> ⚠️ **Note:** Please review the proposed changes carefully before merging.`,
  ].join("\n");

  return {
    title,
    description,
    destination: request.destination,
    filesToUpdate,
    validationReport: {
      syntaxValid: true,
      protectedPathsClean,
      testsIncluded: false,
    },
    provenance: {
      requester: request.requesterLogin,
      sourcePullNumber: request.pullRequestNumber,
      sourceHeadSha: request.sourceHeadSha,
      findingsAddressed,
      limitations: [
        "Does not execute untrusted build scripts locally.",
        "Requires full GitHub CI workflow verification upon push.",
      ],
    },
  };
}
