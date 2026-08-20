import { getDatabase, memories } from "@reviewer/db";
import { BrainCircuit, ShieldCheck, Trash2 } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Badge } from "../../../components/ui/badge";
import { buttonVariants } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";
import { getCurrentPrincipal } from "../../../lib/auth";
import { deleteMemory } from "./actions";

export default async function MemoryPage() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/login");
  const rows = await getDatabase()
    .select()
    .from(memories)
    .where(eq(memories.workspaceId, principal.workspaceId))
    .orderBy(desc(memories.createdAt));
  const canAdmin = principal.role === "owner" || principal.role === "admin";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <p className="text-sm text-cyan-300">Self-learning policy</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Review memory</h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          Preferences are evidence-backed, scoped, visible and reversible. Memory cannot suppress security or
          correctness findings.
        </p>
      </div>
      <Card className="mb-6 border-cyan-950 bg-cyan-950/10">
        <CardContent className="flex gap-3 pt-5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-cyan-300" />
          <p className="text-sm leading-6 text-slate-300">
            A single rejection remains a candidate unless the user explicitly asks the reviewer to remember it.
            Workspace and organization memories require an administrator.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stored preferences</CardTitle>
          <CardDescription>Candidate and active rules retained until an administrator removes them.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <div className="divide-y divide-slate-800">
              {rows.map((memory) => (
                <article key={memory.id} className="flex items-start gap-4 py-5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-900 text-cyan-300">
                    <BrainCircuit className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="capitalize">{memory.scope}</Badge>
                      <Badge className="capitalize">{memory.status}</Badge>
                      <span className="text-xs text-slate-600">
                        {Math.round(memory.confidence * 100)}% confidence · {memory.evidenceCount} evidence
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-medium text-white">{memory.rule}</p>
                    <p className="mt-1 text-sm text-slate-500">{memory.rationale}</p>
                  </div>
                  {canAdmin && (
                    <form action={deleteMemory}>
                      <input type="hidden" name="memoryId" value={memory.id} />
                      <button
                        type="submit"
                        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "text-slate-500 hover:text-red-300")}
                        aria-label="Delete memory"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </form>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-slate-500">No feedback memories have been created.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
