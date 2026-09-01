import { env } from "../../config/env.js";

export interface HubSpotFormDefinition { id:string; name:string; archived?:boolean; formType?:string; }
export interface HubSpotSubmissionValue { name:string; value:string; }
export interface HubSpotSubmission { conversionId:string; submittedAt:number; values:HubSpotSubmissionValue[]; pageUrl?:string; }

function headers(){
  if(!env.HUBSPOT_ACCESS_TOKEN) throw new Error("HUBSPOT_NOT_CONFIGURED");
  return {Authorization:`Bearer ${env.HUBSPOT_ACCESS_TOKEN}`,"Content-Type":"application/json"};
}
async function hs(path:string,init:RequestInit={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),env.HTTP_TIMEOUT_MS);
  try{
    const r=await fetch(`https://api.hubapi.com${path}`,{...init,signal:controller.signal,headers:{...headers(),...(init.headers??{})}});
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

export async function findContactByEmail(email:string):Promise<string|null>{
  const j:any=await hs(`/crm/v3/objects/contacts/search`,{method:"POST",body:JSON.stringify({filterGroups:[{filters:[{propertyName:"email",operator:"EQ",value:email}]}],properties:["email"],limit:2})});
  return j.total===1?String(j.results[0].id):j.results?.[0]?.id?String(j.results[0].id):null;
}

async function noteToContactAssociationType():Promise<number>{
  const j:any=await hs(`/crm/v4/associations/notes/contacts/labels`);
  const types=Array.isArray(j.results)?j.results:[];
  const preferred=types.find((x:any)=>x.category==="HUBSPOT_DEFINED"&&/note/i.test(`${x.label??""} ${x.typeId??""}`))??types.find((x:any)=>x.category==="HUBSPOT_DEFINED")??types[0];
  if(!preferred?.typeId) throw new Error("HUBSPOT_NOTE_CONTACT_ASSOCIATION_NOT_FOUND");
  return Number(preferred.typeId);
}

export async function createContactNote(contactId:string,body:string):Promise<string>{
  const associationTypeId=await noteToContactAssociationType();
  const j:any=await hs(`/crm/v3/objects/notes`,{method:"POST",body:JSON.stringify({
    properties:{hs_timestamp:new Date().toISOString(),hs_note_body:body},
    associations:[{to:{id:contactId},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId}]}]
  })});
  if(!j.id) throw new Error("HUBSPOT_NOTE_ID_MISSING");
  return String(j.id);
}
