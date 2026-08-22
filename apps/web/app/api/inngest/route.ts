import { inngest, workflowFunctions } from "@reviewer/workflows";
import { serve } from "inngest/next";

/**
 * Extends the maximum execution duration for Vercel serverless functions (up to 300 seconds).
 * Prevents Vercel FUNCTION_INVOCATION_TIMEOUT errors during AI model calls.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({ client: inngest, functions: workflowFunctions });

