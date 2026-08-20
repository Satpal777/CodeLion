import { inngest, workflowFunctions } from "@reviewer/workflows";
import { serve } from "inngest/next";

export const { GET, POST, PUT } = serve({ client: inngest, functions: workflowFunctions });
