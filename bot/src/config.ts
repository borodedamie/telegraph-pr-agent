import type { ModelProvenance } from "./ledger.js";
import { z } from "zod";

/**
 * The cutoff belongs to the installer's coding model, not to the bot: the bot uses no LLM and gets
 * its knowledge from Telegraph miners. The date, its basis and a source are required. The coding
 * model may be named; when it is, it is never Telegraph or a miner. With no model named, the
 * cutoff can only be team-assumed.
 */
export function readModelProvenance(
  env: NodeJS.ProcessEnv,
  cutoff: Date,
): ModelProvenance {
  const optional = (value: string | undefined) => value?.trim() || undefined;
  const configuration = z
    .object({
      MODEL_PROVIDER: z
        .string()
        .optional()
        .refine((value) => value !== "assumed-provider", "Configure the actual model provider")
        .refine(
          (value) => value?.toLowerCase() !== "telegraph",
          "MODEL_PROVIDER names the installer's coding model provider, never Telegraph",
        ),
      MODEL_ID: z
        .string()
        .optional()
        .refine((value) => value !== "assumed-model", "Configure the actual model ID")
        .refine(
          (value) => value === undefined || !/^\d+$/.test(value),
          "MODEL_ID names the installer's coding model, never a Telegraph miner id",
        ),
      MODEL_CUTOFF_SOURCE_URL: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        }, "must be an HTTPS source URL without credentials"),
      MODEL_CUTOFF_STATUS: z.enum(["provider-documented", "team-assumed"]),
      MODEL_CONFIGURED_AT: z.string().datetime().optional(),
    })
    .refine((c) => (c.MODEL_PROVIDER === undefined) === (c.MODEL_ID === undefined), {
      message: "Set MODEL_PROVIDER and MODEL_ID together, or leave both empty",
    })
    .refine((c) => c.MODEL_ID !== undefined || c.MODEL_CUTOFF_STATUS === "team-assumed", {
      message: "A provider-documented cutoff needs MODEL_PROVIDER and MODEL_ID; with neither set it is team-assumed",
    })
    .parse({
      ...env,
      MODEL_PROVIDER: optional(env.MODEL_PROVIDER),
      MODEL_ID: optional(env.MODEL_ID),
      MODEL_CONFIGURED_AT: optional(env.MODEL_CONFIGURED_AT),
    });
  return {
    ...(configuration.MODEL_PROVIDER === undefined ? {} : { provider: configuration.MODEL_PROVIDER }),
    ...(configuration.MODEL_ID === undefined ? {} : { model: configuration.MODEL_ID }),
    cutoff: cutoff.toISOString(),
    sourceUrl: configuration.MODEL_CUTOFF_SOURCE_URL,
    status: configuration.MODEL_CUTOFF_STATUS,
    configuredAt: configuration.MODEL_CONFIGURED_AT ?? new Date().toISOString(),
  };
}

/** Public spend dashboard; it reads the repository's own `ledger` branch, so any public repository works. */
export const DASHBOARD_URL = "https://telegraph-pr-agent.vercel.app";
export const dashboardLink = (repository: string): string =>
  `${DASHBOARD_URL}/?repo=${repository}`;
