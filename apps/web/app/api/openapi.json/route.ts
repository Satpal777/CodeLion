import { createOpenApiDocument } from "@reviewer/api";
import { getServerEnv } from "@reviewer/config";
import { NextResponse } from "next/server";

export async function GET() {
  const env = getServerEnv();
  return NextResponse.json(createOpenApiDocument(`${env.APP_URL}/api/v1`), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
