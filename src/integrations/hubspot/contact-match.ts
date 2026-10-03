/**
 * Submission-vs-contact matching. Pure: no network, no DB.
 * The match key is email + phone only; name and address are never compared.
 */

export type MatchField="email"|"phone";
export type MatchKind="FULL"|"PARTIAL"|"NONE";

export interface MatchRecord {
  email?:string;
  phone?:string;
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

/**
 * Classifies a submission against one candidate contact on email + phone. Blank on both sides counts
 * as equal (but is not listed in `matched`); blank on one side only is a difference.
 * FULL = both equal; PARTIAL = exactly one equal and non-blank; NONE = neither.
 */
export function classifyContactMatch(submission:MatchRecord,candidate:MatchRecord):ContactMatch{
  const pairs:Array<[MatchField,string,string]>=[
    ["email",normalizeEmail(submission.email),normalizeEmail(candidate.email)],
    ["phone",normalizePhone(submission.phone),normalizePhone(candidate.phone)]
  ];
  const matched:MatchField[]=[],differing:MatchField[]=[];
  for(const [field,a,b] of pairs){
    if(a!==b)differing.push(field);
    else if(a)matched.push(field);
  }
  const kind:MatchKind=!differing.length?"FULL":matched.length?"PARTIAL":"NONE";
  return{kind,compared:pairs.map(p=>p[0]),matched,differing};
}

const FIELD_LABEL:Record<MatchField,string>={email:"email",phone:"phone"};

function joinLabels(labels:string[]){
  if(labels.length<=1)return labels.join("");
  return`${labels.slice(0,-1).join(", ")} and ${labels[labels.length-1]}`;
}

export function possibleDuplicateNotePrefix(differing:MatchField[]){
  return`Possible duplicate: this form submission's ${joinLabels(differing.map(f=>FIELD_LABEL[f]))} differ from this contact. Contact properties were not changed.`;
}
