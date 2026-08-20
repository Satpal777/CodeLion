import { redirect } from "next/navigation";
import { DashboardNav } from "../../components/dashboard-nav";
import { getCurrentPrincipal } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/login");
  return (
    <div className="flex min-h-screen">
      <DashboardNav principal={principal} />
      <main className="min-w-0 flex-1 p-6 md:p-10">{children}</main>
    </div>
  );
}
