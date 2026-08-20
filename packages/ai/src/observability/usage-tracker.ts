export interface ModelUsageRecord {
  workspaceId: string;
  repositoryId?: string;
  operation: "review" | "chat" | "indexing" | "fix" | "memory_extraction";
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
  createdAt: Date;
}

export interface WorkspaceBudgetLimits {
  maxMonthlySpendUsd: number;
  maxDailySpendUsd: number;
  maxConcurrentWorkflows: number;
  circuitBreakerTripped: boolean;
}

// Pricing estimates per 1M tokens (in USD)
const modelPricing: Record<string, { promptPer1M: number; completionPer1M: number }> = {
  "openai/gpt-5.4": { promptPer1M: 2.5, completionPer1M: 10.0 },
  "openai/gpt-5.4-mini": { promptPer1M: 0.15, completionPer1M: 0.6 },
  "openai/text-embedding-3-small": { promptPer1M: 0.02, completionPer1M: 0.0 },
};

export function estimateModelCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = modelPricing[model] ?? { promptPer1M: 2.0, completionPer1M: 8.0 };
  const promptCost = (promptTokens / 1_000_000) * pricing.promptPer1M;
  const completionCost = (completionTokens / 1_000_000) * pricing.completionPer1M;
  return Number((promptCost + completionCost).toFixed(6));
}

export class UsageTracker {
  private inMemoryLedger: ModelUsageRecord[] = [];

  record(record: Omit<ModelUsageRecord, "totalTokens" | "estimatedCostUsd" | "createdAt">): ModelUsageRecord {
    const totalTokens = record.promptTokens + record.completionTokens;
    const estimatedCostUsd = estimateModelCost(record.model, record.promptTokens, record.completionTokens);
    const entry: ModelUsageRecord = {
      ...record,
      totalTokens,
      estimatedCostUsd,
      createdAt: new Date(),
    };
    this.inMemoryLedger.push(entry);
    return entry;
  }

  getWorkspaceUsage(workspaceId: string, since?: Date): {
    totalCalls: number;
    totalTokens: number;
    totalCostUsd: number;
    byOperation: Record<string, number>;
  } {
    const filtered = this.inMemoryLedger.filter(
      (entry) => entry.workspaceId === workspaceId && (!since || entry.createdAt >= since),
    );

    let totalTokens = 0;
    let totalCostUsd = 0;
    const byOperation: Record<string, number> = {};

    for (const item of filtered) {
      totalTokens += item.totalTokens;
      totalCostUsd += item.estimatedCostUsd;
      byOperation[item.operation] = (byOperation[item.operation] ?? 0) + 1;
    }

    return {
      totalCalls: filtered.length,
      totalTokens,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      byOperation,
    };
  }

  isBudgetExceeded(
    workspaceId: string,
    limits: WorkspaceBudgetLimits,
    dailyUsageUsd: number,
  ): { exceeded: boolean; reason?: string } {
    if (limits.circuitBreakerTripped) {
      return { exceeded: true, reason: "Workspace circuit breaker is active" };
    }
    if (dailyUsageUsd >= limits.maxDailySpendUsd) {
      return {
        exceeded: true,
        reason: `Daily budget exceeded ($${dailyUsageUsd.toFixed(2)} / $${limits.maxDailySpendUsd.toFixed(2)})`,
      };
    }
    return { exceeded: false };
  }
}

export const globalUsageTracker = new UsageTracker();
