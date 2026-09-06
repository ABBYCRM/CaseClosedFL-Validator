import crypto from "node:crypto";
import type { Lead } from "../../validation/schema.js";
import type { HubSpotSubmission } from "./client.js";
import { firstPresent, mapBool, mapCaseType, mapFault, mapInjured, mapState, norm } from "./fields.js";

export interface CombinedSubmission { initial?:HubSpotSubmission; supplemental?:HubSpotSubmission; initialFormGuid:string; supplementalFormGuid:string; }

function values(s?:HubSpotSubmission){const m=new Map<string,string>();for(const v of s?.values??[])m.set(norm(v.name),String(v.value??"").trim());return m;}

export function submissionEmail(s?:HubSpotSubmission){const m=values(s);return firstPresent([m],["email","email_address","contact_email"])?.toLowerCase();}

export function toLead(c:CombinedSubmission):Lead{
  const a=values(c.initial),b=values(c.supplemental),maps=[b,a];
  const email=firstPresent(maps,["email","email_address","contact_email"]);
  const ct=mapCaseType(firstPresent(maps,["case_type","incident_type","type_of_accident","accident_type"]));
  const st=mapState(firstPresent(maps,["service_state","state","incident_state"]));
  if(!ct) throw new Error("HUBSPOT_FORM_CASE_TYPE_UNMAPPED");
  if(!st) throw new Error("HUBSPOT_FORM_STATE_UNMAPPED");
  const conversionIds=[c.initial?.conversionId,c.supplemental?.conversionId].filter(Boolean) as string[];
  const leadId=`hs_${crypto.createHash("sha256").update(conversionIds.sort().join(":" )||`${email}:${Date.now()}`).digest("hex").slice(0,24)}`;
  return {
    lead_id:leadId,state:st,case_type:ct,
    client:{first_name:firstPresent(maps,["firstname","first_name"]),last_name:firstPresent(maps,["lastname","last_name"]),email},
    incident:{
      date:firstPresent(maps,["accident_date","incident_date","date_of_accident"]),county:firstPresent(maps,["county","incident_county"]),city:firstPresent(maps,["city","incident_city"]),agency:firstPresent(maps,["police_agency","agency","law_enforcement_agency"]),report_number:firstPresent(maps,["police_report_number","report_number"]),case_number:firstPresent(maps,["case_number","agency_case_number"]),location:firstPresent(maps,["accident_location","incident_location","address"]),business_name:firstPresent(maps,["property_owner_business","business_name","property_business"]),business_address:firstPresent(maps,["business_address","property_address"]),carrier_name:firstPresent(maps,["carrier_name","commercial_carrier","trucking_company"]),usdot_number:firstPresent(maps,["usdot_number","dot_number"])
    },
    medical:{provider_name:firstPresent(maps,["treating_providers","provider_name","medical_provider"])},
    qualification:{
      injured:mapInjured(firstPresent(maps,["injured","were_you_injured","injury"])),medical_treatment:mapBool(firstPresent(maps,["medical_treatment","treated","received_treatment","treatment_received"])),primary_fault:mapFault(firstPresent(maps,["fault","primary_fault","who_was_at_fault"])),already_represented:mapBool(firstPresent(maps,["already_represented","represented_by_attorney","have_an_attorney"]))
    },
    documents:[],authorization:{external_record_access:false,record_purchase:false},
    metadata:{hubspot:{source:"forms",email,initial_form_guid:c.initialFormGuid,supplemental_form_guid:c.supplementalFormGuid,initial_conversion_id:c.initial?.conversionId,supplemental_conversion_id:c.supplemental?.conversionId,initial_submitted_at:c.initial?.submittedAt,supplemental_submitted_at:c.supplemental?.submittedAt}}
  };
}
