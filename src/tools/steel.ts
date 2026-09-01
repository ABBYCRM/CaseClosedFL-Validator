import { env } from "../config/env.js";
export async function createSteelSession(){if(!env.STEEL_API_KEY)throw new Error("STEEL_NOT_CONFIGURED");const r=await fetch(`${env.STEEL_BASE_URL.replace(/\/$/,"")}/sessions`,{method:"POST",headers:{"steel-api-key":env.STEEL_API_KEY,"Content-Type":"application/json"},body:"{}"});if(!r.ok)throw new Error(`STEEL_${r.status}`);return r.json();}
