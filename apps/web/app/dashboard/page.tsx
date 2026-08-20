import { getDatabase, listActiveMemories, listWorkspaceRepositories, listWorkspaceReviews } from "@reviewer/db";
import { BrainCircuit, CheckCircle2, GitBranch, GitPullRequest } from "lucide-react";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { getCurrentPrincipal } from "../../lib/auth";

export default async function DashboardPage() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/login");
  const database = getDatabase();
  const [repositories, reviews, memories] = await Promise.all([
    listWorkspaceRepositories(database, principal.workspaceId),
    listWorkspaceReviews(database, principal.workspaceId, 5),
    listActiveMemories(database, { workspaceId: principal.workspaceId, userId: principal.user.id }),
  ]);
  const completed = reviews.filter(({ run }) => run.state === "completed").length;

  const metrics = [
    { label: "Connected repositories", value: repositories.length, icon: GitBranch },
    { label: "Recent reviews", value: reviews.length, icon: GitPullRequest },
    { label: "Completed", value: completed, icon: CheckCircle2 },
    { label: "Active memories", value: memories.length, icon: BrainCircuit },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <p className="text-sm text-cyan-300">Workspace overview</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Review operations</h1>
        <p className="mt-2 text-slate-400">Repository indexing, review decisions and learned preferences.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardDescription>{metric.label}</CardDescription>
              <metric.icon className="size-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-white">{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>The latest pull request review runs in this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {reviews.length ? (
            <div className="divide-y divide-slate-800">
              {reviews.map(({ run, repository }) => (
                <div key={run.id} className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {repository.owner}/{repository.name} #{run.pullRequestNumber}
                    </p>
                    <p className="mt-1 line-clamp-1 text-sm text-slate-500">{run.summary ?? "Review is processing"}</p>
                  </div>
                  <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs capitalize text-slate-300">
                    {(run.decision ?? run.state).replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-800 p-10 text-center">
              <GitPullRequest className="mx-auto size-6 text-slate-600" />
              <p className="mt-3 text-sm text-slate-400">No reviews yet. Connect and enable a repository to begin.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
