import type { ModelProvenance } from "./ledger.js";
import { z } from "zod";

/** Require an explicit model identity and sourced cutoff before the paid assessment path. */
export function readModelProvenance(env: NodeJS.ProcessEnv, cutoff: Date): ModelProvenance {
  const configuration = z.object({
    MODEL_PROVIDER: z.string().trim().min(1).refine((value) => value !== "assumed-provider", "Configure the actual model provider"),
    MODEL_ID: z.string().trim().min(1).refine((value) => value !== "assumed-model", "Configure the actual model ID"),
    MODEL_CUTOFF_SOURCE_URL: z.string().url().refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    }, "must be an HTTPS source URL without credentials"),
    MODEL_CUTOFF_STATUS: z.enum(["provider-documented", "team-assumed"]),
    MODEL_CONFIGURED_AT: z.string().datetime().optional(),
  }).parse({ ...env, MODEL_CONFIGURED_AT: env.MODEL_CONFIGURED_AT || undefined });
  return { provider: configuration.MODEL_PROVIDER, model: configuration.MODEL_ID,
    cutoff: cutoff.toISOString(), sourceUrl: configuration.MODEL_CUTOFF_SOURCE_URL,
    status: configuration.MODEL_CUTOFF_STATUS,
    configuredAt: configuration.MODEL_CONFIGURED_AT ?? new Date().toISOString() };
}
