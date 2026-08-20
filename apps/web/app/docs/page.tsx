import { createOpenApiDocument } from "@reviewer/api";
import { getServerEnv } from "@reviewer/config";
import { ArrowLeft, Braces, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "../../components/ui/badge";
import { buttonVariants } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { cn } from "../../lib/utils";

export const dynamic = "force-dynamic";

export default function DocsPage() {
  const env = getServerEnv();
  const document = createOpenApiDocument(`${env.APP_URL}/api/v1`);
  const paths = Object.entries(document.paths ?? {});
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="size-4" /> Back to Reviewer
      </Link>
      <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-300">
            <Braces className="size-5" />
            <span className="text-sm">OpenAPI 3</span>
          </div>
          <h1 className="mt-3 text-4xl font-semibold text-white">Backend API documentation</h1>
          <p className="mt-3 max-w-2xl text-slate-400">
            The same application contracts power tRPC and the generated REST-compatible API.
          </p>
        </div>
        <Link href="/api/openapi.json" className={cn(buttonVariants({ variant: "secondary" }))}>
          Open JSON specification <ExternalLink className="size-4" />
        </Link>
      </div>

      <div className="mt-10 space-y-4">
        {paths.flatMap(([path, operations]) =>
          Object.entries(operations ?? {}).map(([method, operation]) => {
            if (method === "parameters" || !operation || typeof operation !== "object") return null;
            const details = operation as { summary?: string; description?: string; tags?: string[] };
            return (
              <Card key={`${method}-${path}`}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge className="border-cyan-800 bg-cyan-950 text-cyan-300">{method.toUpperCase()}</Badge>
                    <code className="text-sm text-white">{path}</code>
                  </div>
                  <CardTitle className="pt-2 text-base">{details.summary ?? "API operation"}</CardTitle>
                  {details.description && <CardDescription>{details.description}</CardDescription>}
                </CardHeader>
                <CardContent className="text-xs text-slate-500">
                  {details.tags?.join(", ") ?? "Application"}
                </CardContent>
              </Card>
            );
          }),
        )}
      </div>
    </main>
  );
}
