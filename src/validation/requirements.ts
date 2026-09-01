import type { Lead } from "./schema.js";
const MVA=new Set(["AUTO_ACCIDENT","TRUCK_ACCIDENT","MOTORCYCLE_ACCIDENT","RIDESHARE_ACCIDENT","BICYCLE_PEDESTRIAN"]);
export function isMva(lead:Lead){return MVA.has(lead.case_type);}
export function missingRequirements(lead:Lead){
  const missing:string[]=[];
  if(!lead.incident.date) missing.push("incident.date");
  if(isMva(lead)){
    if(!lead.incident.report_number&&!lead.incident.case_number&&!lead.incident.agency&&!lead.incident.location) missing.push("one of incident.report_number, incident.case_number, incident.agency, or incident.location");
    if(lead.qualification.primary_fault===undefined&&lead.qualification.client_claims_not_at_fault===undefined) missing.push("qualification.primary_fault or qualification.client_claims_not_at_fault");
  } else if(!lead.incident.business_name&&!lead.incident.business_address&&!lead.documents.length) missing.push("incident.business_name, incident.business_address, or incident evidence");
  if(lead.qualification.already_represented===undefined) missing.push("qualification.already_represented");
  if(lead.qualification.injured===undefined) missing.push("qualification.injured");
  return missing;
}
export function intakeHardStop(lead:Lead):string|null{
  if(lead.qualification.already_represented===true) return "EXISTING_REPRESENTATION";
  if(isMva(lead)&&(lead.qualification.primary_fault==="CLIENT"||lead.qualification.client_claims_not_at_fault===false)) return "CLIENT_STATES_PRIMARY_FAULT";
  return null;
}
