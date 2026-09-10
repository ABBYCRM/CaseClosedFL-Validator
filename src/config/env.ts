import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

export function applyDotEnv(text:string, existing:NodeJS.ProcessEnv=process.env):Record<string,string>{
  const out:Record<string,string>={};
  for(const [key,value] of Object.entries(existing)){if(value!==undefined) out[key]=value;}
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith("#")) continue;
    const eq=line.indexOf("=");if(eq<=0) continue;
    const key=line.slice(0,eq).trim().replace(/^export\s+/,"");let value=line.slice(eq+1).trim();
    if((value.startsWith("\"")&&value.endsWith("\""))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    if(out[key]===undefined) out[key]=value;
  }
  return out;
}

function loadLocalEnv(){const path=".env";if(!existsSync(path)) return;const parsed=applyDotEnv(readFileSync(path,"utf8"),process.env);for(const [key,value] of Object.entries(parsed)){if(process.env[key]===undefined) process.env[key]=value;}}
loadLocalEnv();

const bool=z.string().default("false").transform((v:string)=>v.toLowerCase()==="true");
const csv=z.string().default("").transform((v:string)=>v.split(",").map((x:string)=>x.trim()).filter(Boolean));
const Schema=z.object({
  NODE_ENV:z.enum(["development","test","production"]).default("development"),
  PORT:z.coerce.number().int().positive().default(8080),
  DATABASE_URL:z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/caseclosed_validator"),
  ADMIN_SECRET:z.string().min(24).default("development-admin-secret-change-me"),
  TOKEN_PEPPER:z.string().min(24).default("development-token-pepper-change-me"),
  MODEL_PROVIDER:z.enum(["bitdeer","openai"]).default("bitdeer"),
  EMBEDDING_PROVIDER:z.enum(["bitdeer","openai","none"]).default("bitdeer"),
  BITDEER_API_KEY:z.string().default(""),
  BITDEER_BASE_URL:z.string().url().default("https://api-inference.bitdeer.ai/v1"),
  BITDEER_REASONING_MODEL:z.string().default("zai-org/GLM-5"),
  BITDEER_FORENSIC_MODEL:z.string().default("mistralai/Mistral-Large-3-675B-Instruct-2512"),
  BITDEER_EMBED_MODEL:z.string().default("nvidia/Nemotron-3-Embed-8B-BF16"),
  BITDEER_EMBED_DIMENSIONS:z.coerce.number().int().positive().max(4096).default(4096),
  BITDEER_RERANK_MODEL:z.string().default("BAAI/bge-reranker-v2-m3"),
  OPENAI_API_KEY:z.string().default(""),
  OPENAI_BASE_URL:z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODEL:z.string().default("gpt-5.4-mini"),
  OPENAI_EMBED_MODEL:z.string().default("text-embedding-3-large"),
  OPENAI_EMBED_DIMENSIONS:z.coerce.number().int().positive().default(4096),
  COMPOSIO_API_KEY:z.string().default(""),
  COMPOSIO_BASE_URL:z.string().url().default("https://backend.composio.dev"),
  COMPOSIO_USER_ID:z.string().default("caseclosedfl-validator"),
  COMPOSIO_TOOLKITS:csv,
  STEEL_API_KEY:z.string().default(""),
  STEEL_BASE_URL:z.string().url().default("https://api.steel.dev/v1"),
  TAVILY_API_KEY:z.string().default(""),
  EXA_API_KEY:z.string().default(""),
  FIRECRAWL_API_KEY:z.string().default(""),
  SCRAPINGBEE_API_KEY:z.string().default(""),
  SCRAPFLY_API_KEY:z.string().default(""),
  SCREENSHOTONE_ACCESS_KEY:z.string().default(""),
  SCREENSHOTONE_SECRET_KEY:z.string().default(""),
  OPENCLAW_ENABLED:bool,
  OPENCLAW_GATEWAY_URL:z.string().url().default("http://127.0.0.1:18789"),
  OPENCLAW_TOKEN:z.string().default(""),
  HUBSPOT_SYNC_ENABLED:bool,
  HUBSPOT_ACCESS_TOKEN:z.string().default(""),
  HUBSPOT_SYNC_MODE:z.enum(["auto","forms","crm_notes"]).default("auto"),
  HUBSPOT_INITIAL_FORM_GUID:z.string().default(""),
  HUBSPOT_EMAIL_FORM_GUID:z.string().default(""),
  HUBSPOT_INITIAL_FORM_ID:z.string().default(""),
  HUBSPOT_EMAIL_FORM_ID:z.string().default(""),
  HUBSPOT_INITIAL_FORM_NAME:z.string().default(""),
  HUBSPOT_EMAIL_FORM_NAME:z.string().default(""),
  HUBSPOT_SYNC_INTERVAL_MS:z.coerce.number().int().min(60_000).default(300_000),
  HUBSPOT_SYNC_LOOKBACK_PAGES:z.coerce.number().int().min(1).max(20).default(4),
  HUBSPOT_SYNC_LOOKBACK_DAYS:z.coerce.number().int().min(1).max(90).default(14),
  HUBSPOT_SYNC_BATCH_SIZE:z.coerce.number().int().min(1).max(100).default(20),
  HUBSPOT_NOTE_MAX_SCREENSHOTS:z.coerce.number().int().min(0).max(10).default(3),
  MAX_MODEL_CALLS:z.coerce.number().int().positive().default(3),
  MAX_TOOL_CALLS:z.coerce.number().int().positive().default(18),
  MAX_CYCLES:z.coerce.number().int().positive().default(12),
  MAX_IDENTICAL_FAILURES:z.coerce.number().int().positive().default(2),
  TOOL_TIMEOUT_MS:z.coerce.number().int().positive().default(20000),
  HTTP_TIMEOUT_MS:z.coerce.number().int().positive().default(12000),
  MAX_DOCUMENT_CHARS:z.coerce.number().int().positive().default(60000),
  KNOWLEDGE_VERSION:z.string().default("2026.09.10"),
  ENGINE_VERSION:z.string().default("1.4.1")
});
export function parseEnv(source:NodeJS.ProcessEnv|Record<string,string|undefined>=process.env){const parsed=Schema.parse(source);return{...parsed,HUBSPOT_INITIAL_FORM_ID:parsed.HUBSPOT_INITIAL_FORM_GUID||parsed.HUBSPOT_INITIAL_FORM_ID,HUBSPOT_EMAIL_FORM_ID:parsed.HUBSPOT_EMAIL_FORM_GUID||parsed.HUBSPOT_EMAIL_FORM_ID};}
export const env=parseEnv();
export type HubSpotSyncMode="forms"|"crm_notes";export type HubSpotSyncModeSetting="auto"|"forms"|"crm_notes";
export function hubspotAllowlistConfigured(cfg:{HUBSPOT_INITIAL_FORM_ID?:string;HUBSPOT_EMAIL_FORM_ID?:string;HUBSPOT_INITIAL_FORM_NAME?:string;HUBSPOT_EMAIL_FORM_NAME?:string;}){const initial=!!cfg.HUBSPOT_INITIAL_FORM_ID||!!cfg.HUBSPOT_INITIAL_FORM_NAME;const supplemental=!!cfg.HUBSPOT_EMAIL_FORM_ID||!!cfg.HUBSPOT_EMAIL_FORM_NAME;return initial&&supplemental;}
export function resolveHubSpotSyncMode(cfg:{HUBSPOT_SYNC_MODE?:HubSpotSyncModeSetting;HUBSPOT_INITIAL_FORM_ID?:string;HUBSPOT_EMAIL_FORM_ID?:string;HUBSPOT_INITIAL_FORM_NAME?:string;HUBSPOT_EMAIL_FORM_NAME?:string;}):HubSpotSyncMode{if(cfg.HUBSPOT_SYNC_MODE==="forms"||cfg.HUBSPOT_SYNC_MODE==="crm_notes")return cfg.HUBSPOT_SYNC_MODE;return hubspotAllowlistConfigured(cfg)?"forms":"crm_notes";}
export function assertHubSpotProductionConfig(cfg:{HUBSPOT_ACCESS_TOKEN?:string;HUBSPOT_SYNC_MODE?:HubSpotSyncModeSetting;HUBSPOT_INITIAL_FORM_ID?:string;HUBSPOT_EMAIL_FORM_ID?:string;HUBSPOT_INITIAL_FORM_NAME?:string;HUBSPOT_EMAIL_FORM_NAME?:string;}){if(!cfg.HUBSPOT_ACCESS_TOKEN)throw new Error("HUBSPOT_ACCESS_TOKEN_REQUIRED");if(resolveHubSpotSyncMode(cfg)==="forms"&&!hubspotAllowlistConfigured(cfg))throw new Error("HUBSPOT_TWO_FORM_ALLOWLIST_REQUIRED");}
export function assertProductionSafety(){if(env.NODE_ENV!=="production")return;if(env.ADMIN_SECRET.includes("development-")||env.TOKEN_PEPPER.includes("development-"))throw new Error("PRODUCTION_SECRETS_NOT_CONFIGURED");if(env.MODEL_PROVIDER==="openai"&&!env.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY_REQUIRED");if((env.MODEL_PROVIDER==="bitdeer"||env.EMBEDDING_PROVIDER==="bitdeer")&&!env.BITDEER_API_KEY)throw new Error("BITDEER_API_KEY_REQUIRED");if(env.HUBSPOT_SYNC_ENABLED)assertHubSpotProductionConfig(env);}
