import { ArrowLeft, Bot, Github, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { cn } from "../../lib/utils";
import { getCurrentPrincipal } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentPrincipal()) redirect("/dashboard");
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="size-4" /> Back
        </Link>
        <Card className="shadow-2xl shadow-cyan-950/20">
          <CardHeader className="items-center text-center">
            <span className="mb-3 grid size-11 place-items-center rounded-xl bg-cyan-400 text-slate-950">
              <Bot className="size-5" />
            </span>
            <CardTitle className="text-xl">Sign in to Reviewer</CardTitle>
            <CardDescription>Use your GitHub identity to access your review workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/api/auth/github/start" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
              <Github className="size-5" /> Continue with GitHub
            </Link>
            <div className="mt-5 flex gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
              <LockKeyhole className="mt-0.5 size-4 shrink-0 text-cyan-300" />
              <p className="text-xs leading-5 text-slate-500">
                Signing in proves identity only. Repository access is granted separately through the Reviewer GitHub
                App and can be limited to selected repositories.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
