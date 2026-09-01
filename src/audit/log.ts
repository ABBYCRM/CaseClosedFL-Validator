import { q } from "../db/index.js";
export async function audit(eventType:string, validationId:string|null, payload:Record<string,unknown>={}) {await q("INSERT INTO audit_events(event_type,validation_id,payload) VALUES($1,$2,$3)", [eventType,validationId,payload]);}
