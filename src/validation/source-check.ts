import type { Lead } from "./schema.js";
import type { SourceDefinition } from "../knowledge/types.js";
import type { SelfState } from "../agent/state.js";
import { runCapability, observationContains, resultDigest } from "../tools/router.js";
import { officialSearchQuery,hostOf } from "../tools/direct.js";
import { addEvidence } from "../evidence/ledger.js";
import { CLAIMS } from "../evidence/claims.js";
import { observeOfficialSourceScreenshot } from "../tools/official-screenshot.js";

function collectUrls(value:unknown,out:string[]=[]):string[]{if(typeof value==="string"){for(const m of value.matchAll(/https?:\/\/[^\s"'<>]+/g))out.push(m[0]);}else if(Array.isArray(value))value.forEach(v=>collectUrls(v,out));else if(value&&typeof value==="object")Object.values(value as any).forEach(v=>collectUrls(v,out));return out;}
function officialObserved(result:unknown,source:SourceDefinition){const host=hostOf(source.url);return collectUrls(result).some(u=>{const h=hostOf(u);return h===host||h.endsWith(`.${host}`);});}
export function requiresAuthorization(source:SourceDefinition,lead:Lead){return source.access==="AUTHORIZED"&&!lead.authorization.external_record_access;}
export interface SourceCheck{corroborated:boolean;authoritative:boolean;evidenceId?:string;tool?:string;reason?:string;}

async function withOfficialScreenshot<T>(validationId:string,state:SelfState,source:SourceDefinition,result:T):Promise<T>{
  await observeOfficialSourceScreenshot(validationId,state,source);
  return result;
}

export async function checkIncidentSource(validationId:string,state:SelfState,lead:Lead,source:SourceDefinition):Promise<SourceCheck>{
  if(requiresAuthorization(source,lead))return{corroborated:false,authoritative:false,reason:"AUTHORIZATION_REQUIRED"};
  const identifier=lead.incident.report_number??lead.incident.case_number,officialHost=hostOf(source.url);
  const terms=[identifier??"",lead.incident.date??"",lead.incident.agency??"",lead.incident.county??""].filter(Boolean);
  const query=officialSearchQuery(source.url,terms);
  let result:SourceCheck={corroborated:false,authoritative:false,reason:"NOT_CORROBORATED"};
  try{const obs=await runCapability(validationId,state,"WEB_SEARCH",{query,max_results:8,search_depth:"advanced",url:source.url});const hasOfficial=officialObserved(obs.result,source),identifierMatch=!!identifier&&observationContains(obs.result,[identifier]),dateMatch=!!lead.incident.date&&observationContains(obs.result,[lead.incident.date]);const corroborated=hasOfficial&&identifierMatch;const ev=await addEvidence(validationId,{claim:corroborated?CLAIMS.INCIDENT_IDENTIFIER_MATCH:"OFFICIAL_SOURCE_SEARCH_OBSERVED",epistemicState:corroborated?"INFERRED":"KNOWN",sourceId:source.id,sourceUrl:source.url,sourceType:corroborated?"GOVERNMENT":"SEARCH_DISCOVERY",toolExecutionId:obs.toolExecutionId,payload:{tool:obs.tool,officialHost,officialUrlObserved:hasOfficial,identifierMatch,dateMatch,resultDigest:resultDigest(obs.result)}});if(corroborated)result={corroborated:true,authoritative:true,evidenceId:ev.id,tool:obs.tool};}catch(e:any){state.warnings.push(`${source.id}:DISCOVERY:${e?.message??"FAILED"}`);}
  if(!result.corroborated){
    try{const instruction=`Read-only validation. Open ${source.url}. Determine whether the supplied incident identifier ${identifier??"(none)"} and date ${lead.incident.date??"(unknown)"} can be corroborated by this official ${source.authority} source. Do not purchase anything, submit a restricted request, bypass authentication/CAPTCHA, or modify data. Return the source URL and only the minimal matching fields.`;const obs=await runCapability(validationId,state,"PUBLIC_RECORD_LOOKUP",{url:source.url,query:instruction,report_number:lead.incident.report_number,case_number:lead.incident.case_number,date:lead.incident.date,agency:lead.incident.agency});const hasOfficial=officialObserved(obs.result,source)||JSON.stringify(obs.result).includes(source.url),identifierMatch=!!identifier&&observationContains(obs.result,[identifier]);if(hasOfficial&&identifierMatch){const ev=await addEvidence(validationId,{claim:CLAIMS.INCIDENT_IDENTIFIER_MATCH,epistemicState:"KNOWN",sourceId:source.id,sourceUrl:source.url,sourceType:"GOVERNMENT",toolExecutionId:obs.toolExecutionId,payload:{tool:obs.tool,identifierMatch:true,resultDigest:resultDigest(obs.result)}});result={corroborated:true,authoritative:true,evidenceId:ev.id,tool:obs.tool};}else result={corroborated:false,authoritative:false,reason:"NOT_CORROBORATED"};}catch(e:any){result={corroborated:false,authoritative:false,reason:e?.message??"SOURCE_LOOKUP_FAILED"};}
  }
  return withOfficialScreenshot(validationId,state,source,result);
}
export async function checkRegistry(validationId:string,state:SelfState,_lead:Lead,source:SourceDefinition,queryTerms:string[],claim:string,cap:"BUSINESS_SEARCH"|"PROVIDER_SEARCH"|"COURT_SEARCH"){const query=officialSearchQuery(source.url,queryTerms.filter(Boolean));try{const obs=await runCapability(validationId,state,cap,{query,max_results:8,url:source.url});const official=officialObserved(obs.result,source),termsMatch=queryTerms.filter(Boolean).length>0&&observationContains(obs.result,queryTerms.filter(Boolean));if(official&&termsMatch){const ev=await addEvidence(validationId,{claim,epistemicState:"INFERRED",sourceId:source.id,sourceUrl:source.url,sourceType:source.dimension==="LITIGATION"?"COURT":source.dimension==="BUSINESS_EXISTENCE"?"BUSINESS_REGISTRY":"LICENSE_REGISTRY",toolExecutionId:obs.toolExecutionId,payload:{tool:obs.tool,resultDigest:resultDigest(obs.result)}});return withOfficialScreenshot(validationId,state,source,{matched:true,evidenceId:ev.id});}return withOfficialScreenshot(validationId,state,source,{matched:false});}catch{return withOfficialScreenshot(validationId,state,source,{matched:false});}}
