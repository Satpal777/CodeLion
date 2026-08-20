import "dotenv/config";
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "self-learning-reviewer",
  isDev: process.env.INNGEST_DEV === "1" || process.env.INNGEST_DEV === "true",
});
