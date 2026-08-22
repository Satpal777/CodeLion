"use client";

import { BotMessageSquare } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { setAIProvider } from "./actions";

interface AIProviderCardProps {
  /** The model name read from OPENAI_COMPATIBLE_MODEL env var. */
  modelName: string;
  /** The provider currently persisted in the session cookie. */
  currentProvider: "gemini" | "openai-compatible";
}

export function AIProviderCard({ modelName, currentProvider }: AIProviderCardProps) {
  const [pending, startTransition] = useTransition();
  const [optimisticProvider, setOptimisticProvider] = useOptimistic(currentProvider);

  function handleToggle(checked: boolean) {
    const next: "gemini" | "openai-compatible" = checked ? "openai-compatible" : "gemini";
    startTransition(async () => {
      setOptimisticProvider(next);
      await setAIProvider(next);
    });
  }

  const isOpenAI = optimisticProvider === "openai-compatible";

  return (
    <Card>
      <CardHeader className="flex-row gap-4">
        <BotMessageSquare className="mt-1 size-5 text-cyan-300" aria-hidden="true" />
        <div className="flex-1">
          <CardTitle>AI provider</CardTitle>
          <CardDescription className="mt-1">
            Switch between Gemini (default with cascade fallback) and your custom
            OpenAI-compatible model. When the custom model fails, the system
            automatically falls back to the Gemini cascade.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Active provider info */}
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-200">
              Active provider:{" "}
              <span className={isOpenAI ? "text-cyan-300" : "text-slate-400"}>
                {isOpenAI ? modelName : "Gemini cascade"}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              {isOpenAI
                ? "Requests go to your custom endpoint first, then fall back to Gemini on error."
                : "All requests use the Gemini model cascade (9-model fallback chain)."}
            </p>
          </div>

          {/* Toggle switch */}
          <label className="relative inline-flex cursor-pointer items-center gap-3">
            <span className="select-none text-sm text-slate-400">Gemini</span>
            <span className="relative">
              <input
                type="checkbox"
                className="sr-only"
                role="switch"
                aria-checked={isOpenAI}
                aria-label={`Use ${isOpenAI ? "Gemini cascade" : modelName} as AI provider`}
                checked={isOpenAI}
                disabled={pending}
                onChange={(e) => handleToggle(e.target.checked)}
              />
              {/* Track */}
              <span
                aria-hidden="true"
                className={[
                  "block h-6 w-11 rounded-full transition-colors duration-200",
                  isOpenAI ? "bg-cyan-500" : "bg-slate-700",
                  pending ? "opacity-50" : "",
                ].join(" ")}
              />
              {/* Thumb */}
              <span
                aria-hidden="true"
                className={[
                  "absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-200",
                  isOpenAI ? "translate-x-5" : "translate-x-0",
                ].join(" ")}
              />
            </span>
            <span className="select-none text-sm text-slate-400">OpenAI-compatible</span>
          </label>
        </div>

        {/* Status badge */}
        <p
          role="status"
          aria-live="polite"
          className={[
            "mt-4 rounded-md border px-3 py-2 text-xs font-medium",
            isOpenAI
              ? "border-cyan-800 bg-cyan-950/60 text-cyan-300"
              : "border-slate-800 bg-slate-900 text-slate-400",
          ].join(" ")}
        >
          {pending
            ? "Saving preference…"
            : isOpenAI
              ? `✓ Using ${modelName} with Gemini fallback`
              : "✓ Using Gemini cascade (9-model fallback chain)"}
        </p>
      </CardContent>
    </Card>
  );
}
