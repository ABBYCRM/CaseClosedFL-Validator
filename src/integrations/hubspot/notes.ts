import crypto from "node:crypto";
import type { Lead } from "../../validation/schema.js";
import { firstPresent, mapBool, mapCaseType, mapDate, mapFault, mapInjured, mapState, mapTreatment, norm, present, stateFromZip } from "./fields.js";

export type NoteKind="intake"|"supplemental"|"validation"|"other";

export interface HubSpotNoteRecord { id:string; body:string; timestampMs:number; }
export interface HubSpotContactRecord {
  id:string;
  email?:string;
  firstName?:string;
  lastName?:string;
  phone?:string;
  state?:string;
  zip?:string;
  city?:string;
}

export interface NotesToLeadInput {
  intake:HubSpotNoteRecord;
  supplementals?:HubSpotNoteRecord[];
  contact:HubSpotContactRecord;
}

export type NotesParseResult=
  |{ok:true; lead:Lead; missing:string[]; fingerprint:string}
  |{ok:false; missing:string[]; fingerprint:string};

const INTAKE_HEADER=/caseclosedfl\s+qualified\s+personal\s+injury\s+intake/i;
const VALIDATION_MARK=/caseclosedfl validation|validation id\s*:|verdict:\s*[🟢🟡🔴⚪]|🚦/i;
const SUPPLEMENTAL_HINT=/caseclosedfl/i;
const SECTION_HEADERS=new Set(["incident_narrative","incident_narratives","narrative","additional_details","additional_notes","notes"]);

const HUBSPOT_HTML_MARK=/<(?:p|br|strong|div|em|span)\b/i;

export function escapeHubSpotHtml(raw:string){
  return String(raw??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

export function isHubSpotNoteHtml(raw:string){
  return HUBSPOT_HTML_MARK.test(String(raw??""));
}

export function toHubSpotNoteHtml(raw:string){
  const text=String(raw??"").replace(/\r\n/g,"\n");
  if(isHubSpotNoteHtml(text)) return text.trim();
  return text.split("\n").map(line=>{
    const leading=line.match(/^[ \t]+/)?.[0]??"";
    const indent="&nbsp;".repeat(leading.replace(/\t/g,"  ").length);
    const bolded=escapeHubSpotHtml(line.slice(leading.length)).replace(/\*([^*]+)\*/g,"<strong>$1</strong>");
    return `<p>${indent}${bolded}</p>`;
  }).join("");
}

export function htmlToText(raw:string){
  return String(raw??"")
    .replace(/\r\n/g,"\n")
    .replace(/<br\s*\/?>/gi,"\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi,"\n")
    .replace(/<[^>]+>/g,"")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&quot;/gi,"\"")
    .replace(/&#39;/gi,"'")
    .replace(/[ \t]+\n/g,"\n")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
}

export function classifyNote(body:string):NoteKind{
  const text=htmlToText(body);
  if(VALIDATION_MARK.test(text))return"validation";
  if(INTAKE_HEADER.test(text))return"intake";
  if(SUPPLEMENTAL_HINT.test(text))return"supplemental";
  return"other";
}

export function intakeFingerprint(intakeNoteId:string,supplementalNoteId?:string){
  return crypto.createHash("sha256").update(`${intakeNoteId}:${supplementalNoteId??""}`).digest("hex").slice(0,40);
}

export function parseLabeledFields(body:string){
  const text=htmlToText(body);
  const fields=new Map<string,string>();
  const lines=text.split("\n").map(l=>l.replace(/^[*_\s]+|[*_\s]+$/g,"").trim()).filter(Boolean);
  let section:string|undefined;
  const sectionBuf:string[]=[];
  const flush=()=>{
    if(!section)return;
    const joined=present(sectionBuf.join("\n"));
    if(joined&&!fields.has(section))fields.set(section,joined);
    sectionBuf.length=0; section=undefined;
  };
  for(const line of lines){
    const stripped=line.replace(/[*_]/g,"").trim();
    const sectionKey=norm(stripped.replace(/:$/,""));
    if(!stripped.includes(":")&&SECTION_HEADERS.has(sectionKey)){
      flush();
      section=sectionKey==="incident_narratives"||sectionKey==="narrative"?"incident_narrative":sectionKey;
      continue;
    }
    const colon=stripped.indexOf(":");
    if(colon>0&&colon<=80){
      const key=norm(stripped.slice(0,colon));
      const value=present(stripped.slice(colon+1));
      if(SECTION_HEADERS.has(key)&&!value){
        flush();
        section=key==="incident_narratives"||key==="narrative"?"incident_narrative":key;
        continue;
      }
      if(section&&SECTION_HEADERS.has(section)&&!SECTION_HEADERS.has(key)){
        sectionBuf.push(line);
        continue;
      }
      flush();
      if(key&&value&&!fields.has(key))fields.set(key,value);
      continue;
    }
    if(section)sectionBuf.push(line);
  }
  flush();
  return fields;
}

export function newestSupplemental(notes:HubSpotNoteRecord[]=[]){
  return [...notes].sort((a,b)=>b.timestampMs-a.timestampMs)[0];
}

function resolveState(fields:Map<string,string>[],contact:HubSpotContactRecord){
  return mapState(contact.state)
    ?? mapState(firstPresent(fields,["service_state","state","incident_state","service"]))
    ?? stateFromZip(firstPresent(fields,["zip","zip_code","postal_code"]))
    ?? stateFromZip(contact.zip);
}

function validEmail(v?:string){
  const t=present(v)?.toLowerCase();
  if(!t||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t))return undefined;
  return t;
}

export function notesToLead(input:NotesToLeadInput):NotesParseResult{
  const supplementals=[...(input.supplementals??[])].sort((a,b)=>a.timestampMs-b.timestampMs);
  const newest=newestSupplemental(supplementals);
  const fingerprint=intakeFingerprint(input.intake.id,newest?.id);
  const maps=[
    ...supplementals.slice().reverse().map(n=>parseLabeledFields(n.body)),
    parseLabeledFields(input.intake.body)
  ];
  const missing:string[]=[];
  const caseType=mapCaseType(firstPresent(maps,["case_type","incident_type","type_of_accident","accident_type"]));
  const state=resolveState(maps,input.contact);
  if(!caseType)missing.push("case_type");
  if(!state)missing.push("state");
  if(!caseType||!state)return{ok:false,missing,fingerprint};

  const email=validEmail(input.contact.email)??validEmail(firstPresent(maps,["email","email_address","contact_email"]));
  const zip=firstPresent(maps,["zip","zip_code","postal_code"])??present(input.contact.zip);
  const narrative=firstPresent(maps,["incident_narrative","narrative"]);
  const treatment=mapTreatment(firstPresent(maps,["treatment","medical_treatment","treated","received_treatment","treatment_received"]));
  const leadId=`hsn_${crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0,24)}`;
  const lead:Lead={
    lead_id:leadId,
    state,
    case_type:caseType,
    client:{
      first_name:present(input.contact.firstName)??firstPresent(maps,["firstname","first_name"]),
      last_name:present(input.contact.lastName)??firstPresent(maps,["lastname","last_name"]),
      email,
      phone:present(input.contact.phone)??firstPresent(maps,["phone","phone_number","mobilephone","mobile"])
    },
    incident:{
      date:mapDate(firstPresent(maps,["accident_date","incident_date","date_of_accident","date"])),
      county:firstPresent(maps,["county","incident_county"]),
      city:firstPresent(maps,["city","incident_city"])??present(input.contact.city),
      agency:firstPresent(maps,["police_agency","agency","law_enforcement_agency"]),
      report_number:firstPresent(maps,["police_report_number","report_number"]),
      case_number:firstPresent(maps,["case_number","agency_case_number"]),
      location:firstPresent(maps,["accident_location","incident_location","address","location"]),
      business_name:firstPresent(maps,["property_owner_business","business_name","property_business"]),
      business_address:firstPresent(maps,["business_address","property_address"]),
      carrier_name:firstPresent(maps,["carrier_name","commercial_carrier","trucking_company"]),
      usdot_number:firstPresent(maps,["usdot_number","dot_number"])
    },
    medical:{provider_name:firstPresent(maps,["treating_providers","provider_name","medical_provider"])},
    qualification:{
      injured:mapInjured(firstPresent(maps,["injured","were_you_injured","injury"])),
      medical_treatment:treatment,
      primary_fault:mapFault(firstPresent(maps,["fault","primary_fault","who_was_at_fault"])),
      already_represented:mapBool(firstPresent(maps,["already_represented","represented_by_attorney","have_an_attorney"]))
    },
    documents:[],
    authorization:{external_record_access:false,record_purchase:false},
    metadata:{
      hubspot:{
        source:"crm_notes",
        contact_id:input.contact.id,
        email,
        phone:present(input.contact.phone),
        zip,
        intake_note_id:input.intake.id,
        supplemental_note_id:newest?.id,
        intake_timestamp:input.intake.timestampMs,
        supplemental_timestamp:newest?.timestampMs,
        fingerprint,
        narrative
      }
    }
  };
  return{ok:true,lead,missing:[],fingerprint};
}

export function findExistingOutcomeNote(notes:HubSpotNoteRecord[],fingerprint:string,validationId?:string){
  for(const note of notes){
    const text=htmlToText(note.body);
    if(validationId&&text.includes(`Validation ID: ${validationId}`))return note.id;
    if(text.includes(`Intake fingerprint: ${fingerprint}`))return note.id;
  }
  return undefined;
}

export function outcomeNoteBody(hubspotNote:string,validationId:string|undefined,fingerprint?:string){
  const base=String(hubspotNote??"").replace(/\r\n/g,"\n").trim();
  const meta:string[]=[];
  if(validationId) meta.push(`Validation ID: ${validationId}`);
  if(fingerprint) meta.push(`Intake fingerprint: ${fingerprint}`);
  if(!meta.length) return toHubSpotNoteHtml(base);
  if(isHubSpotNoteHtml(base)){
    return `${toHubSpotNoteHtml(base)}<p></p>${meta.map(line=>`<p>${escapeHubSpotHtml(line)}</p>`).join("")}`;
  }
  return toHubSpotNoteHtml([base,"",...meta].join("\n"));
}
