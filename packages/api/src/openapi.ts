import { generateOpenApiDocument } from "trpc-to-openapi";
import { appRouter } from "./router";

export function createOpenApiDocument(baseUrl: string) {
  return generateOpenApiDocument(appRouter, {
    title: "Self-learning Reviewer API",
    description: "Typed API for repositories, reviews, feedback and memory administration.",
    version: "0.1.0",
    baseUrl,
    tags: ["System", "Repositories"],
    securitySchemes: {
      session: { type: "apiKey", in: "cookie", name: "reviewer_session" },
    },
  });
}
