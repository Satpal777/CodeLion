import { getDatabase, listWorkspaceRepositories } from "@reviewer/db";
import { ExternalLink, GitBranch, LockKeyhole, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "../../../components/ui/badge";
import { buttonVariants } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";
import { getCurrentPrincipal } from "../../../lib/auth";
import { setRepositoryEnabled, syncRepositories } from "./actions";

export default async function RepositoriesPage() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/login");

  let repositories = await listWorkspaceRepositories(getDatabase(), principal.workspaceId);
  const canAdmin = principal.role === "owner" || principal.role === "admin";

  // Auto-sync if no repositories are listed yet
  if (repositories.length === 0 && canAdmin) {
    try {
      await syncRepositories();
      repositories = await listWorkspaceRepositories(getDatabase(), principal.workspaceId);
    } catch {
      // ignore in UI render
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-cyan-300">GitHub access</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Repositories</h1>
          <p className="mt-2 text-slate-400">Choose exactly which accessible repositories the reviewer may process.</p>
        </div>
        <div className="flex items-center gap-3">
          {canAdmin && (
            <form action={syncRepositories}>
              <button type="submit" className={cn(buttonVariants({ variant: "secondary" }))}>
                <RefreshCw className="size-4" /> Sync Repositories
              </button>
            </form>
          )}
          <Link href="/api/github/install" className={cn(buttonVariants())}>
            <Plus className="size-4" /> Connect GitHub App
          </Link>
        </div>
      </div>

      {repositories.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {repositories.map((repository) => (
            <Card key={repository.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <GitBranch className="size-4 text-cyan-300" />
                    {repository.owner}/{repository.name}
                  </CardTitle>
                  <CardDescription className="mt-2 flex items-center gap-2">
                    {repository.isPrivate && <LockKeyhole className="size-3.5" />}
                    {repository.isPrivate ? "Private" : "Public"} · {repository.defaultBranch}
                  </CardDescription>
                </div>
                <Badge className="capitalize">{repository.state}</Badge>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between border-t border-slate-800 pt-4">
                  <div>
                    <p className="text-sm text-slate-300">Pull request review</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {repository.indexedAt
                        ? `Indexed ${repository.indexedAt.toLocaleDateString()}`
                        : "Not indexed yet"}
                    </p>
                  </div>
                  {canAdmin ? (
                    <form action={setRepositoryEnabled}>
                      <input type="hidden" name="repositoryId" value={repository.id} />
                      <input type="hidden" name="enabled" value={repository.enabled ? "false" : "true"} />
                      <button
                        type="submit"
                        className={cn(
                          buttonVariants({ variant: repository.enabled ? "secondary" : "default", size: "sm" }),
                        )}
                      >
                        {repository.enabled ? "Disable" : "Enable and index"}
                      </button>
                    </form>
                  ) : (
                    <Badge>{repository.enabled ? "Enabled" : "Disabled"}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-16 text-center">
            <GitBranch className="size-8 text-slate-600" />
            <h2 className="mt-4 font-medium text-white">No repositories connected</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
              Install the Reviewer GitHub App and grant access to selected repositories, or click{" "}
              <strong className="text-slate-200">Sync Repositories</strong> if you recently updated repository permissions.
            </p>
            <div className="mt-5 flex gap-3">
              {canAdmin && (
                <form action={syncRepositories}>
                  <button type="submit" className={cn(buttonVariants({ variant: "secondary" }))}>
                    <RefreshCw className="size-4" /> Sync Repositories
                  </button>
                </form>
              )}
              <Link href="/api/github/install" className={cn(buttonVariants())}>
                Install GitHub App <ExternalLink className="size-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
