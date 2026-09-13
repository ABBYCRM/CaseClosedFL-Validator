import type {Lead} from "../../validation/schema.js";
import {isLikelyEmail,normalizePhone} from "./redact.js";

function metadataPhone(lead:Lead):string|undefined{
  const meta=lead.metadata??{};
  const hubspot=meta.hubspot;
  if(hubspot&&typeof hubspot==="object"){
    const phone=(hubspot as {phone?:unknown}).phone;
    if(typeof phone==="string") return phone;
  }
  const direct=meta.phone;
  if(typeof direct==="string") return direct;
  return undefined;
}

export function leadEmail(lead:Lead):string|undefined{
  const email=lead.client.email?.trim();
  if(email&&isLikelyEmail(email)) return email.toLowerCase();
  const meta=lead.metadata??{};
  const hubspot=meta.hubspot;
  if(hubspot&&typeof hubspot==="object"){
    const hsEmail=(hubspot as {email?:unknown}).email;
    if(typeof hsEmail==="string"&&isLikelyEmail(hsEmail)) return hsEmail.trim().toLowerCase();
  }
  return undefined;
}

export function leadPhone(lead:Lead):string|undefined{
  return normalizePhone(lead.client.phone??"")??normalizePhone(metadataPhone(lead)??"");
}
