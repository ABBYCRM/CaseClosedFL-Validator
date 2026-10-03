import { mapState } from "./fields.js";

export type MatchField="email"|"phone"|"name"|"address";
export type MatchKind="FULL"|"PARTIAL"|"NONE";

export interface MatchAddress { street?:string; city?:string; state?:string; zip?:string; }
export interface MatchRecord {
  email?:string;
  phone?:string;
  firstName?:string;
  lastName?:string;
  /** Single full-name field, used only when first/last are both blank. */
  name?:string;
  address?:MatchAddress;
}
export interface ContactMatch {
  kind:MatchKind;
  compared:MatchField[];
  /** Equal and non-blank on both sides. */
  matched:MatchField[];
  /** Not equal (including blank on one side only). */
  differing:MatchField[];
}

export function normalizeEmail(v?:string){
  return String(v??"").trim().toLowerCase();
}

export function normalizePhone(v?:string){
  const raw=String(v??"").trim();
  const digits=raw.replace(/\D/g,"");
  if(!digits)return"";
  if(raw.startsWith("+"))return`+${digits}`;
  if(digits.length===10)return`+1${digits}`;
  if(digits.length===11&&digits.startsWith("1"))return`+${digits}`;
  return"";
}

function cleanText(v?:string){
  return String(v??"").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
}

export function normalizeName(r:Pick<MatchRecord,"firstName"|"lastName"|"name">){
  const first=cleanText(r.firstName),last=cleanText(r.lastName);
  if(first||last)return cleanText(`${first} ${last}`);
  return cleanText(r.name);
}

function addressPart(v?:string){
  return String(v??"").toLowerCase().replace(/[.,#]/g,"").replace(/\s+/g," ").trim();
}

/** street + city + state + ZIP5 compared together; "" when every part is blank. */
export function normalizeAddress(a?:MatchAddress){
  if(!a)return"";
  const street=addressPart(a.street),city=addressPart(a.city);
  const state=mapState(a.state)?.toLowerCase()??addressPart(a.state);
  const zip5=String(a.zip??"").replace(/\D/g,"").slice(0,5);
  if(!street&&!city&&!state&&!zip5)return"";
  return[street,city,state,zip5].join("|");
}

/**
 * Classifies a submission against one candidate contact. Blank on both sides counts as equal
 * (but is not listed in `matched`); blank on one side only is a difference. Address is compared
 * only when `compareAddress` is set, i.e. when the form actually collected one.
 */
export function classifyContactMatch(submission:MatchRecord,candidate:MatchRecord,opts:{compareAddress:boolean}):ContactMatch{
  const pairs:Array<[MatchField,string,string]>=[
    ["email",normalizeEmail(submission.email),normalizeEmail(candidate.email)],
    ["phone",normalizePhone(submission.phone),normalizePhone(candidate.phone)],
    ["name",normalizeName(submission),normalizeName(candidate)]
  ];
  if(opts.compareAddress)pairs.push(["address",normalizeAddress(submission.address),normalizeAddress(candidate.address)]);
  const matched:MatchField[]=[],differing:MatchField[]=[];
  for(const [field,a,b] of pairs){
    if(a!==b)differing.push(field);
    else if(a)matched.push(field);
  }
  const kind:MatchKind=!differing.length?"FULL":matched.length?"PARTIAL":"NONE";
  return{kind,compared:pairs.map(p=>p[0]),matched,differing};
}

const FIELD_LABEL:Record<MatchField,string>={email:"email",phone:"phone",name:"full name",address:"address"};

function joinLabels(labels:string[]){
  if(labels.length<=1)return labels.join("");
  return`${labels.slice(0,-1).join(", ")} and ${labels[labels.length-1]}`;
}

export function possibleDuplicateNotePrefix(differing:MatchField[]){
  return`Possible duplicate: this form submission's ${joinLabels(differing.map(f=>FIELD_LABEL[f]))} differ from this contact. Contact properties were not changed.`;
}
