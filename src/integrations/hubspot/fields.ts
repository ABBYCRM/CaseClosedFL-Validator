import { CASE_TYPES, STATES, type Lead } from "../../validation/schema.js";

export const norm=(s:string)=>s.trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");

export function isAbsent(v?:string){
  if(v===undefined||v===null)return true;
  const t=v.trim();
  if(!t)return true;
  return /^(n\/?a|na|none|unknown|null|undefined|-|—|–)$/i.test(t);
}

export function present(v?:string){
  if(isAbsent(v))return undefined;
  return v!.trim();
}

export function mapBool(v?:string){
  const t=present(v); if(!t)return undefined;
  if(/^(yes|true|1|y)$/i.test(t))return true;
  if(/^(no|false|0|n)$/i.test(t))return false;
  return undefined;
}

export function mapInjured(v?:string):"YES"|"NO"|"UNSURE"|undefined{
  const t=present(v); if(!t)return;
  if(/^yes$/i.test(t))return"YES";
  if(/^no$/i.test(t))return"NO";
  return"UNSURE";
}

const STATE_NAMES:Record<string,Lead["state"]>={
  fl:"FL",florida:"FL",
  ca:"CA",california:"CA",
  az:"AZ",arizona:"AZ",
  tx:"TX",texas:"TX",
  ny:"NY",new_york:"NY"
};

export function mapState(v?:string):Lead["state"]|undefined{
  const t=present(v); if(!t)return;
  const u=t.toUpperCase();
  if((STATES as readonly string[]).includes(u))return u as Lead["state"];
  return STATE_NAMES[norm(t)];
}

export function mapCaseType(v?:string):Lead["case_type"]|undefined{
  const t=present(v); if(!t)return;
  const n=norm(t);
  const map:Record<string,Lead["case_type"]>={
    car:"AUTO_ACCIDENT",car_accident:"AUTO_ACCIDENT",auto:"AUTO_ACCIDENT",auto_accident:"AUTO_ACCIDENT",
    truck:"TRUCK_ACCIDENT",truck_accident:"TRUCK_ACCIDENT",commercial_truck_accident:"TRUCK_ACCIDENT",
    motorcycle:"MOTORCYCLE_ACCIDENT",motorcycle_accident:"MOTORCYCLE_ACCIDENT",
    rideshare:"RIDESHARE_ACCIDENT",rideshare_accident:"RIDESHARE_ACCIDENT",uber_lyft_accident:"RIDESHARE_ACCIDENT",
    bike_pedestrian_accident:"BICYCLE_PEDESTRIAN",bicycle_pedestrian:"BICYCLE_PEDESTRIAN",
    bicycle_accident:"BICYCLE_PEDESTRIAN",pedestrian_accident:"BICYCLE_PEDESTRIAN",
    bike_pedestrian:"BICYCLE_PEDESTRIAN",bicycle:"BICYCLE_PEDESTRIAN",pedestrian:"BICYCLE_PEDESTRIAN",
    slip_fall:"SLIP_FALL",slip_and_fall:"SLIP_FALL"
  };
  if(map[n])return map[n];
  const u=t.toUpperCase();
  return (CASE_TYPES as readonly string[]).includes(u)?u as Lead["case_type"]:undefined;
}

export function mapFault(v?:string):Lead["qualification"]["primary_fault"]|undefined{
  const t=present(v); if(!t)return;
  const n=norm(t);
  if(/other|not_me|other_party/.test(n))return"OTHER_PARTY";
  if(/shared|both|comparative/.test(n))return"SHARED";
  if(/not_sure|unsure|unknown/.test(n))return"NOT_SURE";
  if(/client|my_fault|me/.test(n))return"CLIENT";
  return undefined;
}

export function mapTreatment(v?:string){
  const t=present(v); if(!t)return undefined;
  const n=norm(t);
  if(/^(no|false|0|none|untreated)$/.test(n))return false;
  if(/^(yes|true|1|y)$/.test(n))return true;
  // Observed treatment description (ER, hospital, doctor, etc.) is treatment received.
  return true;
}

export function mapDate(v?:string){
  const t=present(v); if(!t)return undefined;
  if(/^\d{4}-\d{2}-\d{2}$/.test(t))return t;
  const m=t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(!m)return undefined;
  return `${m[3]}-${m[1]!.padStart(2,"0")}-${m[2]!.padStart(2,"0")}`;
}

/** Deterministic USPS prefix ranges for the five CaseClosedFL states only. */
export function stateFromZip(zip?:string):Lead["state"]|undefined{
  const t=present(zip); if(!t)return;
  const digits=t.replace(/\D/g,"");
  if(digits.length<5)return;
  const n=Number(digits.slice(0,5));
  if(n>=32000&&n<=34999)return"FL";
  if(n>=90000&&n<=96199)return"CA";
  if(n>=85000&&n<=86599)return"AZ";
  if((n>=75000&&n<=79999)||n===73301||(n>=88500&&n<=88599))return"TX";
  if(n>=10000&&n<=14999)return"NY";
  return undefined;
}

export function firstPresent(maps:Map<string,string>[],aliases:string[]){
  for(const a of aliases.map(norm)){
    for(const m of maps){
      const v=present(m.get(a));
      if(v)return v;
    }
  }
  return undefined;
}
