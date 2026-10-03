import { env } from "../../config/env.js";
import { listValidationScreenshots, type ValidationScreenshot } from "../../evidence/screenshots.js";
import { toHubSpotNoteHtml } from "./notes.js";
import { modernizeTrustedFormRetainSentence } from "./trustedform.js";

export interface HubSpotHttpOptions {
  fetch?:typeof fetch;
  accessToken?:string;
  timeoutMs?:number;
  associationTypeId?:number;
}

export interface HubSpotFormDefinition { id:string; name:string; archived?:boolean; formType?:string; }
export interface HubSpotSubmissionValue { name:string; value:string; }
export interface HubSpotSubmission { conversionId:string; submittedAt:number; values:HubSpotSubmissionValue[]; pageUrl?:string; }

function accessToken(opts?:HubSpotHttpOptions){
  const token=opts?.accessToken??env.HUBSPOT_ACCESS_TOKEN;
  if(!token) throw new Error("HUBSPOT_NOT_CONFIGURED");
  return token;
}
function headers(opts?:HubSpotHttpOptions){
  return {Authorization:`Bearer ${accessToken(opts)}`,"Content-Type":"application/json"};
}
async function hs(path:string,init:RequestInit={},opts?:HubSpotHttpOptions){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),opts?.timeoutMs??env.HTTP_TIMEOUT_MS);
  const fetchImpl=opts?.fetch??fetch;
  try{
    const r=await fetchImpl(`https://api.hubapi.com${path}`,{...init,signal:controller.signal,headers:{...headers(opts),...(init.headers??{})}});
    const text=await r.text();
    if(!r.ok) throw new Error(`HUBSPOT_${r.status}:${text.slice(0,500)}`);
    return text?JSON.parse(text):{};
  } finally { clearTimeout(timer); }
}

export async function listForms():Promise<HubSpotFormDefinition[]>{
  const out:HubSpotFormDefinition[]=[]; let after:string|undefined;
  do{
    const qs=new URLSearchParams({limit:"100",formTypes:"all"}); if(after)qs.set("after",after);
    const j:any=await hs(`/marketing/v3/forms?${qs}`);
    for(const f of j.results??[]) out.push({id:String(f.id),name:String(f.name),archived:!!f.archived,formType:f.formType});
    after=j.paging?.next?.after;
  }while(after);
  return out;
}

export async function getFormSubmissions(formGuid:string,after?:string){
  const qs=new URLSearchParams({limit:"50"}); if(after)qs.set("after",after);
  const j:any=await hs(`/form-integrations/v1/submissions/forms/${encodeURIComponent(formGuid)}?${qs}`);
  return {results:(j.results??[]) as HubSpotSubmission[],after:j.paging?.next?.after as string|undefined};
}

export function uniqueHubSpotContactId(search: {results?: Array<{id?: string}>}): string | null {
  const results = Array.isArray(search.results) ? search.results.filter((row) => row?.id) : [];
  if (results.length !== 1) return null;
  return String(results[0]!.id);
}

export async function findContactByEmail(email:string):Promise<string|null>{
  const j:any=await hs(`/crm/v3/objects/contacts/search`,{method:"POST",body:JSON.stringify({filterGroups:[{filters:[{propertyName:"email",operator:"EQ",value:email}]}],properties:["email"],limit:2})});
  return uniqueHubSpotContactId(j);
}

async function noteToContactAssociationType(opts?:HubSpotHttpOptions):Promise<number>{
  if(opts?.associationTypeId) return opts.associationTypeId;
  const j:any=await hs(`/crm/v4/associations/notes/contacts/labels`,{},opts);
  const types=Array.isArray(j.results)?j.results:[];
  const preferred=types.find((x:any)=>x.category==="HUBSPOT_DEFINED"&&/note/i.test(`${x.label??""} ${x.typeId??""}`))??types.find((x:any)=>x.category==="HUBSPOT_DEFINED")??types[0];
  if(!preferred?.typeId) throw new Error("HUBSPOT_NOTE_CONTACT_ASSOCIATION_NOT_FOUND");
  return Number(preferred.typeId);
}

export function noteCreatePayload(contactId:string,body:string,associationTypeId:number,attachmentIds:string[]=[]){
  const properties:Record<string,string>={hs_timestamp:new Date().toISOString(),hs_note_body:toHubSpotNoteHtml(body)};
  if(attachmentIds.length) properties.hs_attachment_ids=attachmentIds.join(";");
  return {
    properties,
    associations:[{to:{id:contactId},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId}]}]
  };
}

export function privateFileUploadOptions(){
  return {access:"PRIVATE",overwrite:false,duplicateValidationStrategy:"NONE",duplicateValidationScope:"ENTIRE_PORTAL"};
}

export function missingScopesFromHubSpotError(text:string):string[]|null{
  let j:any;
  try{j=JSON.parse(text);}catch{return null;}
  if(!j||typeof j!=="object")return null;
  const message=String(j.message??"");
  if(j.category!=="MISSING_SCOPES"&&!/required scopes|scopes? (?:is|are) required/i.test(message))return null;
  const scopes:string[]=[];
  const add=(scope:unknown)=>{
    const s=String(scope??"").trim().replace(/^["']|["']$/g,"");
    if(s&&!scopes.includes(s))scopes.push(s);
  };
  for(const err of Array.isArray(j.errors)?j.errors:[]){
    const required=err?.context?.requiredGranularScopes;
    if(Array.isArray(required))required.forEach(add);
  }
  if(!scopes.length){
    const listed=message.match(/scopes are required:\s*\[([^\]]*)\]/i)?.[1];
    if(listed)listed.split(",").forEach(add);
  }
  return scopes;
}

export async function uploadPrivateFile(input:{fileName:string;bytes:Buffer;contentType:string},opts?:HubSpotHttpOptions):Promise<string>{
  const form=new FormData();
  form.append("file",new Blob([new Uint8Array(input.bytes)],{type:input.contentType||"application/octet-stream"}),input.fileName);
  form.append("fileName",input.fileName);
  form.append("folderPath","/caseclosedfl-validator");
  form.append("options",JSON.stringify(privateFileUploadOptions()));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),opts?.timeoutMs??env.HTTP_TIMEOUT_MS);
  const fetchImpl=opts?.fetch??fetch;
  try{
    const r=await fetchImpl("https://api.hubapi.com/files/v3/files",{
      method:"POST",
      signal:controller.signal,
      headers:{Authorization:`Bearer ${accessToken(opts)}`},
      body:form
    });
    const text=await r.text();
    if(r.status===403){
      const scopes=missingScopesFromHubSpotError(text);
      if(scopes?.length) throw new Error(`HUBSPOT_403_MISSING_SCOPES:${scopes.join(",")}`);
    }
    if(!r.ok) throw new Error(`HUBSPOT_${r.status}:${text.slice(0,500)}`);
    const j=text?JSON.parse(text):{};
    if(!j.id) throw new Error("HUBSPOT_FILE_ID_MISSING");
    return String(j.id);
  }finally{clearTimeout(timer);}
}

export interface HubSpotTokenInfo { appId:number|null; hubId:number|null; userId:number|null; scopes:string[]; }

function optionalId(v:unknown){
  const n=Number(v);
  return v!==null&&v!==undefined&&v!==""&&Number.isFinite(n)?n:null;
}

// Best effort only: returns null on any failure and never exposes the token.
export async function describeHubSpotToken(opts?:HubSpotHttpOptions):Promise<HubSpotTokenInfo|null>{
  const token=opts?.accessToken??env.HUBSPOT_ACCESS_TOKEN;
  if(!token)return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),opts?.timeoutMs??5000);
  const fetchImpl=opts?.fetch??fetch;
  try{
    const r=await fetchImpl("https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info",{
      method:"POST",
      signal:controller.signal,
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({tokenKey:token})
    });
    if(!r.ok)return null;
    const j:any=await r.json();
    if(!j||typeof j!=="object")return null;
    const scopes=Array.isArray(j.scopes)?j.scopes.map((s:unknown)=>String(s)).filter((s:string)=>s&&s!==token):[];
    return {appId:optionalId(j.appId),hubId:optionalId(j.hubId),userId:optionalId(j.userId),scopes};
  }catch{
    return null;
  }finally{clearTimeout(timer);}
}

export async function uploadScreenshotFiles(screenshots:Array<Pick<ValidationScreenshot,"file_name"|"bytes"|"content_type">>,opts?:HubSpotHttpOptions){
  const attachmentIds:string[]=[];
  const errors:string[]=[];
  for(const shot of screenshots){
    try{
      attachmentIds.push(await uploadPrivateFile({
        fileName:shot.file_name,
        bytes:shot.bytes,
        contentType:shot.content_type
      },opts));
    }catch(e:any){
      errors.push(String(e?.message??"HUBSPOT_FILE_UPLOAD_FAILED").slice(0,300));
    }
  }
  return {attachmentIds,errors};
}

export async function createContactNote(contactId:string,body:string,attachmentIds:string[]=[],opts?:HubSpotHttpOptions):Promise<string>{
  const associationTypeId=await noteToContactAssociationType(opts);
  const j:any=await hs(`/crm/v3/objects/notes`,{method:"POST",body:JSON.stringify(noteCreatePayload(contactId,body,associationTypeId,attachmentIds))},opts);
  if(!j.id) throw new Error("HUBSPOT_NOTE_ID_MISSING");
  return String(j.id);
}

export async function createContactNoteWithScreenshots(contactId:string,body:string,validationId?:string,opts?:HubSpotHttpOptions){
  const attachmentIds:string[]=[];
  const uploadErrors:string[]=[];
  if(validationId){
    try{
      const shots=await listValidationScreenshots(validationId,env.HUBSPOT_NOTE_MAX_SCREENSHOTS);
      const uploaded=await uploadScreenshotFiles(shots,opts);
      attachmentIds.push(...uploaded.attachmentIds);
      uploadErrors.push(...uploaded.errors);
    }catch(e:any){
      uploadErrors.push(String(e?.message??"HUBSPOT_SCREENSHOT_ATTACH_FAILED").slice(0,300));
    }
  }
  const noteId=await createContactNote(contactId,body,attachmentIds,opts);
  return {noteId,attachmentIds,uploadErrors};
}

export interface HubSpotCrmNote { id:string; body:string; timestampMs:number; }
export interface HubSpotCrmContact {
  id:string;
  email?:string;
  firstName?:string;
  lastName?:string;
  phone?:string;
  state?:string;
  zip?:string;
  city?:string;
  emailBounceReason?:string;
  trustedFormCertUrl?:string;
  trustedFormPingUrl?:string;
  trustedFormRetainStatus?:string;
  trustedFormRetainExpiresAt?:string;
  trustedFormRetainResult?:string;
}

const BASE_CONTACT_PROPS=["email","firstname","lastname","phone","mobilephone","state","hs_state_code","zip","city","hs_email_hard_bounce_reason_enum"];
const TRUSTEDFORM_CONTACT_PROPS=["trustedform_cert_url","xxtrustedformcerturl","trustedform_ping_url","xxtrustedformpingurl","trustedform_retain_status","trustedform_retain_expires_at","trustedform_retain_result"];
const CONTACT_PROPS=[...BASE_CONTACT_PROPS,...TRUSTEDFORM_CONTACT_PROPS];
const BASE_CONTACT_PROP_SET=new Set(BASE_CONTACT_PROPS);

function noteTimestampMs(props:any){
  const raw=props?.hs_timestamp??props?.hs_lastmodifieddate??props?.hs_createdate;
  if(raw===undefined||raw===null||raw==="")return 0;
  const n=Number(raw);
  if(Number.isFinite(n)&&n>0)return n;
  const parsed=Date.parse(String(raw));
  return Number.isNaN(parsed)?0:parsed;
}

function asNote(row:any):HubSpotCrmNote|undefined{
  const id=row?.id?String(row.id):undefined;
  if(!id)return;
  return{id,body:String(row.properties?.hs_note_body??""),timestampMs:noteTimestampMs(row.properties??{})};
}

function asContact(row:any):HubSpotCrmContact|undefined{
  const id=row?.id?String(row.id):undefined;
  if(!id)return;
  const p=row.properties??{};
  return{
    id,
    email:p.email||undefined,
    firstName:p.firstname||undefined,
    lastName:p.lastname||undefined,
    phone:p.phone||p.mobilephone||undefined,
    state:p.hs_state_code||p.state||undefined,
    zip:p.zip||undefined,
    city:p.city||undefined,
    emailBounceReason:p.hs_email_hard_bounce_reason_enum||undefined,
    trustedFormCertUrl:p.trustedform_cert_url||p.xxtrustedformcerturl||undefined,
    trustedFormPingUrl:p.trustedform_ping_url||p.xxtrustedformpingurl||undefined,
    trustedFormRetainStatus:p.trustedform_retain_status||undefined,
    trustedFormRetainExpiresAt:p.trustedform_retain_expires_at||undefined,
    trustedFormRetainResult:p.trustedform_retain_result?modernizeTrustedFormRetainSentence(p.trustedform_retain_result):undefined
  };
}

export async function searchNotesSince(sinceMs:number,after?:string){
  const body:Record<string,unknown>={
    filterGroups:[{filters:[{propertyName:"hs_timestamp",operator:"GTE",value:String(sinceMs)}]}],
    properties:["hs_note_body","hs_timestamp","hs_lastmodifieddate"],
    sorts:[{propertyName:"hs_timestamp",direction:"DESCENDING"}],
    limit:100
  };
  if(after)body.after=after;
  const j:any=await hs(`/crm/v3/objects/notes/search`,{method:"POST",body:JSON.stringify(body)});
  return{
    results:((j.results??[]).map(asNote).filter(Boolean) as HubSpotCrmNote[]),
    after:j.paging?.next?.after as string|undefined
  };
}

export async function getNoteContactIds(noteIds:string[]):Promise<Map<string,string[]>>{
  const out=new Map<string,string[]>();
  for(let i=0;i<noteIds.length;i+=100){
    const chunk=noteIds.slice(i,i+100);
    if(!chunk.length)continue;
    const j:any=await hs(`/crm/v4/associations/notes/contacts/batch/read`,{method:"POST",body:JSON.stringify({inputs:chunk.map(id=>({id}))})});
    for(const row of j.results??[]){
      const from=String(row.from?.id??"");
      const ids=(row.to??[]).map((t:any)=>String(t.toObjectId??t.id??"")).filter(Boolean);
      if(from)out.set(from,ids);
    }
  }
  return out;
}

export async function getContactNoteIds(contactId:string){
  const ids:string[]=[]; let after:string|undefined;
  do{
    const qs=new URLSearchParams({limit:"500"}); if(after)qs.set("after",after);
    const j:any=await hs(`/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/notes?${qs}`);
    for(const row of j.results??[]){
      const id=String(row.toObjectId??row.id??"");
      if(id)ids.push(id);
    }
    after=j.paging?.next?.after;
  }while(after);
  return ids;
}

export async function readNotes(noteIds:string[]):Promise<HubSpotCrmNote[]>{
  const out:HubSpotCrmNote[]=[];
  for(let i=0;i<noteIds.length;i+=100){
    const chunk=noteIds.slice(i,i+100);
    if(!chunk.length)continue;
    const j:any=await hs(`/crm/v3/objects/notes/batch/read`,{method:"POST",body:JSON.stringify({properties:["hs_note_body","hs_timestamp","hs_lastmodifieddate"],inputs:chunk.map(id=>({id}))})});
    for(const row of j.results??[]){
      const note=asNote(row);
      if(note)out.push(note);
    }
  }
  return out;
}

function hubspotErrorMessage(error:unknown){
  return String((error as {message?:string})?.message??error);
}

function isUnknownPropertyError(message:string){
  return /propert(?:y|ies)/i.test(message)&&/does not exist|do not exist|doesn't exist|PROPERTY_DOESNT_EXIST|unknown property|not a valid property|is not defined/i.test(message);
}

function unknownPropertyNames(message:string){
  const text=message.replace(/\\+"/g,'"');
  const found:string[]=[];
  const add=(name?:string)=>{
    if(!name||!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))return;
    if(/^(?:property|properties)$/i.test(name)||found.includes(name))return;
    found.push(name);
  };
  for(const match of text.matchAll(/"propertyName"\s*:\s*\[([^\]]*)\]/gi)){
    for(const name of (match[1]??"").matchAll(/"([A-Za-z][A-Za-z0-9_]*)"/g)) add(name[1]);
  }
  for(const match of text.matchAll(/"([A-Za-z][A-Za-z0-9_]*)"\s+does not exist/gi)) add(match[1]);
  for(const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s+does not exist/gi)) add(match[1]);
  for(const match of text.matchAll(/"name"\s*:\s*"([A-Za-z][A-Za-z0-9_]*)"/gi)){
    const start=match.index??0;
    const around=text.slice(Math.max(0,start-160),start+160);
    if(/PROPERTY_DOESNT_EXIST|does not exist/i.test(around)) add(match[1]);
  }
  return found;
}

function namedMissingOptional(properties:string[],message:string){
  const optional=new Set(properties.filter(name=>!BASE_CONTACT_PROP_SET.has(name)));
  return unknownPropertyNames(message).filter(name=>optional.has(name));
}

async function readContactBatch(contactIds:string[],properties:string[],opts?:HubSpotHttpOptions):Promise<Map<string,HubSpotCrmContact>>{
  const out=new Map<string,HubSpotCrmContact>();
  for(let i=0;i<contactIds.length;i+=100){
    const chunk=contactIds.slice(i,i+100);
    if(!chunk.length)continue;
    const j:any=await hs(`/crm/v3/objects/contacts/batch/read`,{method:"POST",body:JSON.stringify({properties,inputs:chunk.map(id=>({id}))})},opts);
    for(const row of j.results??[]){
      const contact=asContact(row);
      if(contact)out.set(contact.id,contact);
    }
  }
  return out;
}

async function rejectedOptionalProperties(contactIds:string[],properties:string[],opts?:HubSpotHttpOptions){
  const optional=properties.filter(name=>!BASE_CONTACT_PROP_SET.has(name));
  const sample=contactIds.slice(0,1);
  const rejected:string[]=[];
  for(const prop of optional){
    if(rejected.includes(prop))continue;
    const requested=[...BASE_CONTACT_PROPS,prop];
    try{
      await readContactBatch(sample,requested,opts);
    }catch(error){
      const message=hubspotErrorMessage(error);
      if(!isUnknownPropertyError(message)) throw error;
      const named=unknownPropertyNames(message).filter(name=>requested.includes(name));
      if(named.some(name=>BASE_CONTACT_PROP_SET.has(name))) throw error;
      if(!named.length||named.includes(prop)) rejected.push(prop);
    }
  }
  return rejected;
}

export async function readContacts(contactIds:string[],opts?:HubSpotHttpOptions):Promise<Map<string,HubSpotCrmContact>>{
  // A missing TrustedForm property is removed on its own. The other requested fields stay.
  let properties=[...CONTACT_PROPS];
  const seen=new Set<string>();
  let lastError:unknown;
  for(;;){
    const key=properties.join("\n");
    if(seen.has(key)) throw lastError??new Error("HUBSPOT_CONTACT_PROPERTIES_UNRESOLVED");
    seen.add(key);
    try{
      return await readContactBatch(contactIds,properties,opts);
    }catch(error){
      lastError=error;
      const message=hubspotErrorMessage(error);
      if(!isUnknownPropertyError(message)) throw error;
      const named=unknownPropertyNames(message);
      let drop=namedMissingOptional(properties,message);
      if(!drop.length&&named.some(name=>BASE_CONTACT_PROP_SET.has(name)&&properties.includes(name))) throw error;
      if(!drop.length) drop=await rejectedOptionalProperties(contactIds,properties,opts);
      if(!drop.length) throw error;
      const next=properties.filter(name=>!drop.includes(name));
      if(next.length===properties.length) throw error;
      properties=next;
    }
  }
}

