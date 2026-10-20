import { z } from "zod";

const envSchema = z.object({
  CHAIN_ID: z.coerce.number().int().positive(),
  USDC_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 40-hex address"),
  NODE_URL: z.string().url(),
  MODEL_CUTOFF: z.string().datetime({ message: "must be an ISO 8601 datetime" }),
  BUDGET_CAP_USDC: z.coerce.number().positive(),
  MAX_PRICE_PER_CALL_USDC: z.coerce.number().positive(),
  TELEGRAPH_EVM_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 64-hex key"),
  GH_PAT: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().url(),
  DEMO_REPO: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "must be owner/repo"),
});

export interface Config {
  chainId: number;
  usdcAddress: string;
  nodeUrl: string;
  modelCutoff: Date;
  budgetCapUsdc: number;
  maxPricePerCallUsdc: number;
  evmPrivateKey: `0x${string}`;
  ghPat: string;
  llmApiKey: string;
  llmBaseUrl: string;
  demoRepo: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid config — ${detail}`);
  }
  const e = parsed.data;
  return {
    chainId: e.CHAIN_ID,
    usdcAddress: e.USDC_ADDRESS,
    nodeUrl: e.NODE_URL.replace(/\/$/, ""),
    modelCutoff: new Date(e.MODEL_CUTOFF),
    budgetCapUsdc: e.BUDGET_CAP_USDC,
    maxPricePerCallUsdc: e.MAX_PRICE_PER_CALL_USDC,
    evmPrivateKey: e.TELEGRAPH_EVM_PRIVATE_KEY as `0x${string}`,
    ghPat: e.GH_PAT,
    llmApiKey: e.LLM_API_KEY,
    llmBaseUrl: e.LLM_BASE_URL.replace(/\/$/, ""),
    demoRepo: e.DEMO_REPO,
  };
}
