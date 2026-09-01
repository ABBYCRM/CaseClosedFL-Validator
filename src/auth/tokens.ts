import crypto from "node:crypto";
import { q } from "../db/index.js";
import { env } from "../config/env.js";
const ALLOWED_SCOPES=new Set(["validate","read-result"]);const hash=(t:string)=>crypto.createHmac("sha256",env.TOKEN_PEPPER).update(t).digest("hex");
export async function mint(name:string,scopes:string[]){const normalized=[...new Set(scopes.filter(s=>ALLOWED_SCOPES.has(s)))];if(!normalized.length)throw new Error("NO_VALID_SCOPES");const raw=`ccv_live_${crypto.randomBytes(32).toString("base64url")}`;const prefix=raw.slice(0,16);const rows=await q<{id:string}>("INSERT INTO api_tokens(name,prefix,token_hash,scopes) VALUES($1,$2,$3,$4) RETURNING id",[name.slice(0,120),prefix,hash(raw),normalized]);return {id:rows[0]!.id,token:raw,prefix,scopes:normalized};}
export async function verify(raw:string,scope:string){if(!raw.startsWith("ccv_live_")||raw.length>128)return null;const rows=await q<any>("SELECT * FROM api_tokens WHERE token_hash=$1 AND revoked_at IS NULL",[hash(raw)]);const t=rows[0];if(!t||!Array.isArray(t.scopes)||!t.scopes.includes(scope))return null;await q("UPDATE api_tokens SET last_used_at=now() WHERE id=$1",[t.id]);return t;}
export function adminAuthorized(value:unknown){if(typeof value!=="string")return false;const a=Buffer.from(value),b=Buffer.from(env.ADMIN_SECRET);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
