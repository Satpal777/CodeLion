import {
  Bot,
  BrainCircuit,
  BookOpen,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  LogOut,
  Settings,
} from "lucide-react";
import Link from "next/link";
import type { WebPrincipal } from "../lib/auth";
import { buttonVariants } from "./ui/button";
import { cn } from "../lib/utils";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/repositories", label: "Repositories", icon: GitBranch },
  { href: "/dashboard/reviews", label: "Reviews", icon: GitPullRequest },
  { href: "/dashboard/memory", label: "Memory", icon: BrainCircuit },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function DashboardNav({ principal }: { principal: WebPrincipal }) {
  return (
    <aside className="flex min-h-screen w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 p-4">
      <Link href="/dashboard" className="mb-8 flex items-center gap-2 px-2 text-sm font-semibold text-white">
        <span className="grid size-8 place-items-center rounded-lg bg-cyan-400 text-slate-950">
          <Bot className="size-4" />
        </span>
        Reviewer
      </Link>
      <nav className="space-y-1">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-900 hover:text-white"
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-slate-800 pt-4">
        <Link
          href="/docs"
          className="mb-3 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-400 hover:text-white"
        >
          <BookOpen className="size-4" /> API documentation
        </Link>
        <div className="flex items-center gap-3 px-3 py-2">
          {principal.user.avatarUrl ? (
            // GitHub avatars are covered by the CSP and contain no application secrets.
            <img src={principal.user.avatarUrl} alt="" className="size-8 rounded-full" />
          ) : (
            <span className="grid size-8 place-items-center rounded-full bg-slate-800 text-xs text-white">
              {principal.user.githubLogin.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{principal.user.githubLogin}</p>
            <p className="text-xs capitalize text-slate-500">{principal.role}</p>
          </div>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8")}
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
