import { createHash } from "node:crypto";
import { getServerEnv } from "@reviewer/config";
import {
  getDatabase,
  markOutboxPublished,
  recordWebhookDelivery,
  recordWebhookDeliveryWithOutbox,
} from "@reviewer/db";
import {
  parseWebhookEnvelope,
  toReviewerEvent,
  verifyWebhookSignature,
} from "@reviewer/github";
import { createWorkflowEvent, inngest } from "@reviewer/workflows";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const env = getServerEnv();
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 2_000_000) {
    return NextResponse.json({ error: "Webhook payload too large" }, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 2_000_000) {
    return NextResponse.json({ error: "Webhook payload too large" }, { status: 413 });
  }
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), env.GITHUB_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const deliveryId = request.headers.get("x-github-delivery");
  const eventName = request.headers.get("x-github-event");
  if (
    !deliveryId ||
    !eventName ||
    deliveryId.length > 100 ||
    eventName.length > 100 ||
    !/^[a-z_]+$/.test(eventName)
  ) {
    return NextResponse.json({ error: "Missing GitHub delivery headers" }, { status: 400 });
  }

  let envelope;
  try {
    envelope = parseWebhookEnvelope(rawBody);
  } catch {
    return NextResponse.json({ error: "Unsupported webhook payload" }, { status: 400 });
  }

  const database = getDatabase(env.DATABASE_URL);
  const delivery = {
    deliveryId,
    eventName,
    ...(envelope.action ? { action: envelope.action } : {}),
    ...(envelope.installation ? { installationId: envelope.installation.id } : {}),
    ...(envelope.repository ? { repositoryId: envelope.repository.id.toString() } : {}),
    payloadHash: createHash("sha256").update(rawBody).digest("hex"),
    status: "accepted",
  };
  const event = toReviewerEvent(eventName, deliveryId, envelope);
  if (!event) {
    const accepted = await recordWebhookDelivery(database, delivery);
    return NextResponse.json(
      { accepted: true, queued: false, duplicate: !accepted },
      { status: 202 },
    );
  }

  const stored = await recordWebhookDeliveryWithOutbox(database, { delivery, event });
  if (!stored.accepted) {
    return NextResponse.json({ accepted: true, duplicate: true }, { status: 202 });
  }
  try {
    await inngest.send(createWorkflowEvent(event.name, event.data, event.id));
    await markOutboxPublished(database, event.id);
  } catch (error) {
    console.error("Inngest event publication deferred to outbox", {
      deliveryId,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  return NextResponse.json({ accepted: true, queued: Boolean(event) }, { status: 202 });
}
