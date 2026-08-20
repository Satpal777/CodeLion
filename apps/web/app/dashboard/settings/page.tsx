import { Database, KeyRound, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { getCurrentPrincipal } from "../../../lib/auth";
import { deleteAccount } from "./actions";

export default async function SettingsPage() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/login");

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <p className="text-sm text-cyan-300">Workspace controls</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-2 text-slate-400">Security, retention and administrative operations.</p>
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader className="flex-row gap-4">
            <KeyRound className="mt-1 size-5 text-cyan-300" />
            <div>
              <CardTitle>GitHub authorization</CardTitle>
              <CardDescription className="mt-1">
                Repository access comes from the installed GitHub App. Installation tokens are short-lived and are
                never stored in the database.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="flex-row gap-4">
            <Database className="mt-1 size-5 text-cyan-300" />
            <div>
              <CardTitle>Data retention</CardTitle>
              <CardDescription className="mt-1">
                Repository indexes, reviews and learned memory are retained until an administrator deletes the
                relevant memory or the workspace owner deletes the account.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
        {principal.role === "owner" && (
          <Card className="border-red-950">
            <CardHeader className="flex-row gap-4">
              <ShieldAlert className="mt-1 size-5 text-red-400" />
              <div>
                <CardTitle>Delete account and workspace</CardTitle>
                <CardDescription className="mt-1">
                  Permanently removes sessions, installations, repository indexes, review history, feedback, memory
                  and audit records. GitHub App uninstallation is still completed in GitHub.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form action={deleteAccount} className="flex flex-col gap-3 sm:flex-row">
                <label className="sr-only" htmlFor="confirmation">
                  GitHub login confirmation
                </label>
                <input
                  id="confirmation"
                  name="confirmation"
                  required
                  placeholder={`Type ${principal.user.githubLogin} to confirm`}
                  autoComplete="off"
                  className="h-10 min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:ring-2 focus:ring-red-500"
                />
                <Button type="submit" variant="destructive">
                  Delete all data
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
