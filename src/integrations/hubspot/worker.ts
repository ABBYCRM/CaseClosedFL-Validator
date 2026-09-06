import { env } from "../../config/env.js";
import { q } from "../../db/index.js";
import { startValidation } from "../../agent/controller.js";
import { createContactNote, findContactByEmail, getFormSubmissions, listForms, type HubSpotSubmission } from "./client.js";
import { submissionEmail, toLead } from "./mapper.js";

type FormRole={initial:string;supplemental:string};
type NamedForm={id:string;name:string;archived?:boolean};

export function resolveFormId(opts:{id?:string;name?:string;forms:NamedForm[];role:string}):string{
  if(opts.id)return opts.id;
  const name=opts.name?.trim();
  if(!name)throw new Error(`HUBSPOT_FORM_ALLOWLIST_UNRESOLVED:${opts.role}=0`);
  const needle=name.toLowerCase();
  const matches=opts.forms.filter(f=>!f.archived&&f.name.trim().toLowerCase()===needle);
  if(matches.length!==1)throw new Error(`HUBSPOT_FORM_ALLOWLIST_UNRESOLVED:${opts.role}=${matches.length}`);
  return matches[0]!.id;
}

export const PENDING_EMAILS_SQL=`SELECT DISTINCT s.contact_email
  FROM hubspot_form_submissions s
  WHERE s.processed_at IS NULL
    AND s.contact_email IS NOT NULL
    AND s.form_guid IN ($1,$2)
    AND EXISTS (
      SELECT 1 FROM hubspot_form_submissions i
      WHERE i.form_guid=$1
        AND i.contact_email IS NOT NULL
        AND lower(i.contact_email)=lower(s.contact_email)
    )
  ORDER BY s.contact_email
  LIMIT $3`;

async function resolveForms():Promise<FormRole>{
  const needNames=!env.HUBSPOT_INITIAL_FORM_ID||!env.HUBSPOT_EMAIL_FORM_ID;
  const forms=needNames?(await listForms()).filter(f=>!f.archived):[];
  const initial=resolveFormId({id:env.HUBSPOT_INITIAL_FORM_ID||undefined,name:env.HUBSPOT_INITIAL_FORM_NAME||undefined,forms,role:"initial"});
  const supplemental=resolveFormId({id:env.HUBSPOT_EMAIL_FORM_ID||undefined,name:env.HUBSPOT_EMAIL_FORM_NAME||undefined,forms,role:"supplemental"});
  if(initial===supplemental)throw new Error("HUBSPOT_FORM_ALLOWLIST_DUPLICATE");
  return{initial,supplemental};
}

async function ingest(formGuid:string){
  let after:string|undefined; let pages=0; let count=0;
  do{
    const page=await getFormSubmissions(formGuid,after); pages++; after=page.after;
    for(const s of page.results){
      const email=submissionEmail(s);
      await q(`INSERT INTO hubspot_form_submissions(conversion_id,form_guid,submitted_at,contact_email,page_url,payload)
        VALUES($1,$2,to_timestamp($3/1000.0),$4,$5,$6)
        ON CONFLICT(conversion_id) DO UPDATE SET payload=excluded.payload,contact_email=excluded.contact_email,page_url=excluded.page_url`,
        [s.conversionId,formGuid,s.submittedAt,email??null,s.pageUrl??null,s]);
      count++;
    }
  }while(after&&pages<env.HUBSPOT_SYNC_LOOKBACK_PAGES);
  await q(`INSERT INTO hubspot_bridge_state(form_guid,last_polled_at,last_success_at,last_error) VALUES($1,now(),now(),NULL)
    ON CONFLICT(form_guid) DO UPDATE SET last_polled_at=now(),last_success_at=now(),last_error=NULL`,[formGuid]);
  return count;
}

function asSubmission(row:any):HubSpotSubmission{return row.payload as HubSpotSubmission;}

async function processEmail(email:string,forms:FormRole){
  const initialRows=await q<any>(`SELECT * FROM hubspot_form_submissions WHERE form_guid=$1 AND lower(contact_email)=lower($2) ORDER BY submitted_at DESC LIMIT 1`,[forms.initial,email]);
  if(!initialRows[0])return{email,status:"WAITING_FOR_INITIAL_FORM"};
  const supplementalRows=await q<any>(`SELECT * FROM hubspot_form_submissions WHERE form_guid=$1 AND lower(contact_email)=lower($2) ORDER BY submitted_at DESC LIMIT 1`,[forms.supplemental,email]);
  const initial=asSubmission(initialRows[0]); const supplemental=supplementalRows[0]?asSubmission(supplementalRows[0]):undefined;
  const latestMs=Math.max(initial.submittedAt,supplemental?.submittedAt??0);
  const already=await q<any>(`SELECT 1 FROM hubspot_form_submissions WHERE lower(contact_email)=lower($1) AND processed_at IS NOT NULL AND submitted_at=to_timestamp($2/1000.0) LIMIT 1`,[email,latestMs]);
  if(already[0])return{email,status:"ALREADY_PROCESSED"};
  try{
    const lead=toLead({initial,supplemental,initialFormGuid:forms.initial,supplementalFormGuid:forms.supplemental});
    const contactId=await findContactByEmail(email);
    if(!contactId)throw new Error("HUBSPOT_CONTACT_NOT_FOUND_FOR_FORM_EMAIL");
    const prior=await q<any>(`SELECT validation_id FROM hubspot_form_submissions WHERE lower(contact_email)=lower($1) AND form_guid IN ($2,$3) AND validation_id IS NOT NULL AND submitted_at=to_timestamp($4/1000.0) LIMIT 1`,[email,forms.initial,forms.supplemental,latestMs]);
    let result:any;
    if(prior[0]?.validation_id){
      const stored=await q<any>(`SELECT result FROM validation_results WHERE validation_id=$1`,[prior[0].validation_id]);
      if(stored[0]?.result)result={validation_id:prior[0].validation_id,...stored[0].result};
    }
    if(!result){
      result=await startValidation(lead);
      await q(`UPDATE hubspot_form_submissions SET validation_id=$2,last_error=NULL WHERE lower(contact_email)=lower($1) AND form_guid IN ($3,$4) AND submitted_at<=to_timestamp($5/1000.0)`,[email,result.validation_id,forms.initial,forms.supplemental,latestMs]);
    }
    const noteBody=`${result.hubspot_note??result.human_note??result.agent_note?.text??result.agent_note?.summary}\n\nValidation ID: ${result.validation_id}`;
    const noteId=await createContactNote(contactId,noteBody);
    await q(`UPDATE hubspot_form_submissions SET processed_at=now(),validation_id=$2,note_id=$3,last_error=NULL
      WHERE lower(contact_email)=lower($1) AND form_guid IN ($4,$5) AND submitted_at<=to_timestamp($6/1000.0)`,[email,result.validation_id,noteId,forms.initial,forms.supplemental,latestMs]);
    return{email,status:"PROCESSED",validation_id:result.validation_id,note_id:noteId};
  }catch(e:any){
    const message=String(e?.message??"HUBSPOT_BRIDGE_PROCESSING_FAILED").slice(0,1000);
    await q(`UPDATE hubspot_form_submissions SET last_error=$2 WHERE lower(contact_email)=lower($1) AND processed_at IS NULL`,[email,message]);
    return{email,status:"FAILED",error:message};
  }
}

export async function syncHubSpotOnce(){
  if(!env.HUBSPOT_SYNC_ENABLED)return{enabled:false};
  const forms=await resolveForms();
  const [initialCount,supplementalCount]=await Promise.all([ingest(forms.initial),ingest(forms.supplemental)]);
  const pending=await q<any>(PENDING_EMAILS_SQL,[forms.initial,forms.supplemental,env.HUBSPOT_SYNC_BATCH_SIZE]);
  const results=[];for(const row of pending)results.push(await processEmail(row.contact_email,forms));
  return{enabled:true,forms,ingested:{initial:initialCount,supplemental:supplementalCount},processed:results};
}

export function startHubSpotWorker(log:(obj:unknown,msg?:string)=>void){
  if(!env.HUBSPOT_SYNC_ENABLED)return()=>{};
  let stopped=false,running=false;
  const tick=async()=>{if(stopped||running)return;running=true;try{const r=await syncHubSpotOnce();log(r,"HubSpot form sync complete");}catch(e:any){log({error:e?.message??String(e)},"HubSpot form sync failed");}finally{running=false;}};
  void tick(); const timer=setInterval(()=>void tick(),env.HUBSPOT_SYNC_INTERVAL_MS);timer.unref();
  return()=>{stopped=true;clearInterval(timer);};
}
