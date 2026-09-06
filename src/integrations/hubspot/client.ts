import { env } from "../../config/env.js";
import { listValidationScreenshots, type ValidationScreenshot } from "../../evidence/screenshots.js";

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
  const properties:Record<string,string>={hs_timestamp:new Date().toISOString(),hs_note_body:body};
  if(attachmentIds.length) properties.hs_attachment_ids=attachmentIds.join(";");
  return {
    properties,
    associations:[{to:{id:contactId},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId}]}]
  };
}

export function privateFileUploadOptions(){
  return {access:"PRIVATE",overwrite:false,duplicateValidationStrategy:"NONE",duplicateValidationScope:"ENTIRE_PORTAL"};
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
    if(!r.ok) throw new Error(`HUBSPOT_${r.status}:${text.slice(0,500)}`);
    const j=text?JSON.parse(text):{};
    if(!j.id) throw new Error("HUBSPOT_FILE_ID_MISSING");
    return String(j.id);
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
}

const CONTACT_PROPS=["email","firstname","lastname","phone","mobilephone","state","hs_state_code","zip","city"];

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
    city:p.city||undefined
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

export async function readContacts(contactIds:string[]):Promise<Map<string,HubSpotCrmContact>>{
  const out=new Map<string,HubSpotCrmContact>();
  for(let i=0;i<contactIds.length;i+=100){
    const chunk=contactIds.slice(i,i+100);
    if(!chunk.length)continue;
    const j:any=await hs(`/crm/v3/objects/contacts/batch/read`,{method:"POST",body:JSON.stringify({properties:CONTACT_PROPS,inputs:chunk.map(id=>({id}))})});
    for(const row of j.results??[]){
      const contact=asContact(row);
      if(contact)out.set(contact.id,contact);
    }
  }
  return out;
}

