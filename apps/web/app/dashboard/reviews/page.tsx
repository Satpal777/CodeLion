import { getDatabase, listWorkspaceReviews } from "@reviewer/db";
import { CheckCircle2, CircleAlert, GitPullRequest, MessageSquareText } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { getCurrentPrincipal } from "../../../lib/auth";
import { submitReviewFeedback } from "./actions";

const decisionIcon = {
  approve: CheckCircle2,
  comment: MessageSquareText,
  request_changes: CircleAlert,
  skipped: CircleAlert,
} as const;

export default async function ReviewsPage() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/login");
  const reviews = await listWorkspaceReviews(getDatabase(), principal.workspaceId, 100);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <p className="text-sm text-cyan-300">Decision history</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Pull request reviews</h1>
        <p className="mt-2 text-slate-400">Every review is immutable for a specific pull request head SHA.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Review runs</CardTitle>
          <CardDescription>Newest first, across all enabled repositories.</CardDescription>
        </CardHeader>
        <CardContent>
          {reviews.length ? (
            <div className="divide-y divide-slate-800">
              {reviews.map(({ run, repository }) => {
                const Icon = run.decision ? decisionIcon[run.decision] : GitPullRequest;
                return (
                  <article key={run.id} className="flex gap-4 py-5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-900 text-cyan-300">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-white">
                          {repository.owner}/{repository.name} #{run.pullRequestNumber}
                        </p>
                        <Badge className="capitalize">{(run.decision ?? run.state).replace("_", " ")}</Badge>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{run.summary ?? "Review processing"}</p>
                      <p className="mt-2 font-mono text-xs text-slate-600">
                        {run.headSha.slice(0, 12)} · {run.createdAt.toLocaleString()}
                      </p>
                      {run.state === "completed" && principal.role !== "viewer" && (
                        <details className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                          <summary className="cursor-pointer text-xs font-medium text-cyan-300">
                            Rate this review
                          </summary>
                          <form action={submitReviewFeedback} className="mt-4 grid gap-3 md:grid-cols-4">
                            <input type="hidden" name="repositoryId" value={repository.id} />
                            <input type="hidden" name="reviewRunId" value={run.id} />
                            <label className="text-xs text-slate-400">
                              Result
                              <select
                                name="verdict"
                                defaultValue="accepted"
                                className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white"
                              >
                                <option value="accepted">Accepted</option>
                                <option value="partially_accepted">Partially accepted</option>
                                <option value="rejected">Rejected</option>
                                <option value="not_applicable">Not applicable</option>
                              </select>
                            </label>
                            <label className="text-xs text-slate-400">
                              Rating
                              <select
                                name="rating"
                                defaultValue="5"
                                className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white"
                              >
                                {[5, 4, 3, 2, 1].map((rating) => (
                                  <option key={rating} value={rating}>
                                    {rating} / 5
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs text-slate-400 md:col-span-2">
                              Explanation
                              <input
                                name="comment"
                                placeholder="What should the reviewer do differently?"
                                className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white"
                              />
                            </label>
                            <label className="flex items-center gap-2 text-xs text-slate-400 md:col-span-3">
                              <input name="explicitRemember" type="checkbox" className="size-4 accent-cyan-400" />
                              Remember this as a repository preference when the review is rejected
                            </label>
                            <button
                              type="submit"
                              className="h-9 rounded-md bg-cyan-400 px-4 text-sm font-medium text-slate-950 hover:bg-cyan-300"
                            >
                              Save feedback
                            </button>
                          </form>
                        </details>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-slate-500">No review runs have been recorded.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
