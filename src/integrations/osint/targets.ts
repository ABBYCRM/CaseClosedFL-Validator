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

/** First + last name for CourtListener party search. One token is too broad. */
export function leadPersonName(lead:Lead):string|undefined{
  const first=String(lead.client.first_name??"").trim();
  const last=String(lead.client.last_name??"").trim();
  if(!first||!last) return undefined;
  const full=`${first} ${last}`.replace(/\s+/g," ").trim();
  return full.length>=3?full:undefined;
}
