import crypto from "node:crypto";
import { CASE_TYPES, STATES, type Lead } from "../../validation/schema.js";
import type { HubSpotSubmission } from "./client.js";

export interface CombinedSubmission { initial?:HubSpotSubmission; supplemental?:HubSpotSubmission; initialFormGuid:string; supplementalFormGuid:string; }

const norm=(s:string)=>s.trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
function values(s?:HubSpotSubmission){const m=new Map<string,string>();for(const v of s?.values??[])m.set(norm(v.name),String(v.value??"").trim());return m;}
function first(maps:Map<string,string>[],aliases:string[]){for(const a of aliases.map(norm))for(const m of maps){const v=m.get(a);if(v)return v;}return undefined;}
function bool(v?:string){if(!v)return undefined;if(/^(yes|true|1|y)$/i.test(v))return true;if(/^(no|false|0|n)$/i.test(v))return false;return undefined;}
function injured(v?:string):"YES"|"NO"|"UNSURE"|undefined{if(!v)return; if(/^yes$/i.test(v))return"YES";if(/^no$/i.test(v))return"NO";return"UNSURE";}
function state(v?:string):Lead["state"]|undefined{if(!v)return;const u=v.trim().toUpperCase();return (STATES as readonly string[]).includes(u)?u as Lead["state"]:undefined;}
function caseType(v?:string):Lead["case_type"]|undefined{if(!v)return;const n=norm(v);const map:Record<string,Lead["case_type"]>={car_accident:"AUTO_ACCIDENT",auto_accident:"AUTO_ACCIDENT",truck_accident:"TRUCK_ACCIDENT",commercial_truck_accident:"TRUCK_ACCIDENT",motorcycle_accident:"MOTORCYCLE_ACCIDENT",rideshare_accident:"RIDESHARE_ACCIDENT",uber_lyft_accident:"RIDESHARE_ACCIDENT",bike_pedestrian_accident:"BICYCLE_PEDESTRIAN",bicycle_pedestrian:"BICYCLE_PEDESTRIAN",bicycle_accident:"BICYCLE_PEDESTRIAN",pedestrian_accident:"BICYCLE_PEDESTRIAN",slip_fall:"SLIP_FALL",slip_and_fall:"SLIP_FALL"};if(map[n])return map[n];const u=v.trim().toUpperCase();return (CASE_TYPES as readonly string[]).includes(u)?u as Lead["case_type"]:undefined;}
function fault(v?:string):Lead["qualification"]["primary_fault"]|undefined{if(!v)return;const n=norm(v);if(/other|not_me|other_party/.test(n))return"OTHER_PARTY";if(/shared|both|comparative/.test(n))return"SHARED";if(/not_sure|unsure|unknown/.test(n))return"NOT_SURE";if(/client|my_fault|me/.test(n))return"CLIENT";return undefined;}

export function submissionEmail(s?:HubSpotSubmission){const m=values(s);return first([m],["email","email_address","contact_email"])?.toLowerCase();}

export function toLead(c:CombinedSubmission):Lead{
  const a=values(c.initial),b=values(c.supplemental),maps=[b,a];
  const email=first(maps,["email","email_address","contact_email"]);
  const ct=caseType(first(maps,["case_type","incident_type","type_of_accident","accident_type"]));
  const st=state(first(maps,["service_state","state","incident_state"]));
  if(!ct) throw new Error("HUBSPOT_FORM_CASE_TYPE_UNMAPPED");
  if(!st) throw new Error("HUBSPOT_FORM_STATE_UNMAPPED");
  const conversionIds=[c.initial?.conversionId,c.supplemental?.conversionId].filter(Boolean) as string[];
  const leadId=`hs_${crypto.createHash("sha256").update(conversionIds.sort().join(":" )||`${email}:${Date.now()}`).digest("hex").slice(0,24)}`;
  return {
    lead_id:leadId,state:st,case_type:ct,
    client:{first_name:first(maps,["firstname","first_name"]),last_name:first(maps,["lastname","last_name"]),email},
    incident:{
      date:first(maps,["accident_date","incident_date","date_of_accident"]),county:first(maps,["county","incident_county"]),city:first(maps,["city","incident_city"]),agency:first(maps,["police_agency","agency","law_enforcement_agency"]),report_number:first(maps,["police_report_number","report_number"]),case_number:first(maps,["case_number","agency_case_number"]),location:first(maps,["accident_location","incident_location","address"]),business_name:first(maps,["property_owner_business","business_name","property_business"]),business_address:first(maps,["business_address","property_address"]),carrier_name:first(maps,["carrier_name","commercial_carrier","trucking_company"]),usdot_number:first(maps,["usdot_number","dot_number"])
    },
    medical:{provider_name:first(maps,["treating_providers","provider_name","medical_provider"])},
    qualification:{
      injured:injured(first(maps,["injured","were_you_injured","injury"])),medical_treatment:bool(first(maps,["medical_treatment","treated","received_treatment","treatment_received"])),primary_fault:fault(first(maps,["fault","primary_fault","who_was_at_fault"])),already_represented:bool(first(maps,["already_represented","represented_by_attorney","have_an_attorney"]))
    },
    documents:[],authorization:{external_record_access:false,record_purchase:false},
    metadata:{hubspot:{source:"forms",email,initial_form_guid:c.initialFormGuid,supplemental_form_guid:c.supplementalFormGuid,initial_conversion_id:c.initial?.conversionId,supplemental_conversion_id:c.supplemental?.conversionId,initial_submitted_at:c.initial?.submittedAt,supplemental_submitted_at:c.supplemental?.submittedAt}}
  };
}
