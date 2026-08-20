import { ArrowRight, Bot, BrainCircuit, GitPullRequest, LockKeyhole, ScanSearch } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { cn } from "../lib/utils";

const features = [
  {
    icon: ScanSearch,
    title: "Repository-aware review",
    description: "Indexes symbols and relevant code so findings account for behavior beyond the changed file.",
  },
  {
    icon: GitPullRequest,
    title: "Precise GitHub feedback",
    description: "Posts validated inline findings and a concise review decision bound to the current head SHA.",
  },
  {
    icon: BrainCircuit,
    title: "Controlled learning",
    description: "Turns explicit and repeated feedback into visible, scoped, reversible review preferences.",
  },
  {
    icon: LockKeyhole,
    title: "Security boundaries",
    description: "Uses least-privilege GitHub Apps, signed webhooks, tenant filters, audit trails and guarded writes.",
  },
];

export default function HomePage() {
  return (
    <main>
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="grid size-8 place-items-center rounded-lg bg-cyan-400 text-slate-950">
            <Bot className="size-4" />
          </span>
          Reviewer
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/docs" className="text-sm text-slate-400 hover:text-white">
            API docs
          </Link>
          <Link href="/login" className={cn(buttonVariants({ size: "sm" }))}>
            Sign in with GitHub
          </Link>
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-900 bg-cyan-950/40 px-3 py-1 text-xs text-cyan-300">
            <span className="size-1.5 rounded-full bg-cyan-300" />
            Reviews that learn your codebase
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight text-white md:text-7xl">
            Ship with a reviewer that knows the whole repository.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-400">
            High-signal pull request review, repository context, GitHub-native conversations and preferences that
            improve from verified feedback without weakening security.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>
              Connect GitHub <ArrowRight className="size-4" />
            </Link>
            <Link href="/docs" className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}>
              Explore the API
            </Link>
          </div>
        </div>

        <Card className="overflow-hidden shadow-2xl shadow-cyan-950/20">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3 text-xs text-slate-500">
            <span>payments/reconcile.ts</span>
            <span>PR #184</span>
          </div>
          <div className="space-y-1 bg-slate-950 p-5 font-mono text-xs leading-6">
            <p className="text-slate-600">@@ -42,6 +42,8 @@</p>
            <p className="text-slate-400"> const payment = await loadPayment(id);</p>
            <p className="bg-emerald-950/40 text-emerald-300">+ await ledger.credit(payment.amount);</p>
            <p className="bg-emerald-950/40 text-emerald-300">+ await payment.markComplete();</p>
          </div>
          <CardContent className="border-t border-slate-800 pt-5">
            <div className="flex gap-3">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-amber-400/10 text-amber-300">
                <Bot className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-white">Partial failure can duplicate ledger credit</p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  If status persistence fails after the credit succeeds, the retry credits the same payment again.
                  Use the repository&apos;s idempotency key at the ledger boundary.
                </p>
                <p className="mt-3 text-xs text-cyan-300">High confidence · Request changes</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-2 lg:grid-cols-4">
        {features.map((feature) => (
          <Card key={feature.title}>
            <CardHeader>
              <feature.icon className="mb-3 size-5 text-cyan-300" />
              <CardTitle className="text-base">{feature.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-slate-400">{feature.description}</CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
