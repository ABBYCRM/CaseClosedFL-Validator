import {describe,expect,it,vi} from "vitest";
import {
  classifyContactMatch,normalizeAddress,normalizeEmail,normalizeName,normalizePhone,possibleDuplicateNotePrefix,type MatchRecord
} from "../src/integrations/hubspot/contact-match.js";
import {readContactIdentity,type HubSpotContactIdentity} from "../src/integrations/hubspot/client.js";
import {submissionContactAddress,toLead} from "../src/integrations/hubspot/mapper.js";
import {formOutcomeNote,matchFormContact} from "../src/integrations/hubspot/worker.js";

const existing:MatchRecord={
  email:"jane.doe@example.com",phone:"(561) 405-0478",firstName:"Jane",lastName:"Doe",
  address:{street:"123 Main St.",city:"West Palm Beach",state:"FL",zip:"33401-1234"}
};
const ADDR={compareAddress:true};

describe("contact-match normalization",()=>{
  it("normalizes email without stripping plus-addressing",()=>{
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(normalizeEmail("a+x@gmail.com")).not.toBe(normalizeEmail("a@gmail.com"));
  });
  it("normalizes phones to E.164 or blank",()=>{
    expect(normalizePhone("(561) 405-0478")).toBe("+15614050478");
    expect(normalizePhone("1-561-405-0478")).toBe("+15614050478");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("405-0478")).toBe("");
    expect(normalizePhone("")).toBe("");
  });
  it("compares full names, not first names",()=>{
    expect(normalizeName({firstName:"  Jane ",lastName:"  Doe  "})).toBe("jane doe");
    expect(normalizeName({name:"JANE   DOE"})).toBe("jane doe");
    expect(normalizeName({firstName:"Jane",lastName:"Doe"})).not.toBe(normalizeName({firstName:"Jane",lastName:"Smith"}));
  });
  it("compares street + city + state + ZIP5 together",()=>{
    expect(normalizeAddress({street:"123 Main St.",city:"West Palm Beach",state:"Florida",zip:"33401-1234"}))
      .toBe(normalizeAddress({street:"123  main st",city:"west palm beach",state:"FL",zip:"33401"}));
    expect(normalizeAddress({street:"#4 Oak Ave",city:"Miami",state:"FL",zip:"33101"})).not.toBe(normalizeAddress({street:"4 Oak Ave",city:"Tampa",state:"FL",zip:"33101"}));
    expect(normalizeAddress({})).toBe("");
  });
  it("treats blank on both sides as equal and blank on one side as different",()=>{
    const a={email:"x@example.com",firstName:"A",lastName:"B"};
    expect(classifyContactMatch(a,{...a},{compareAddress:false}).kind).toBe("FULL");
    const r=classifyContactMatch({...a,phone:"5614050478"},a,{compareAddress:false});
    expect(r.kind).toBe("PARTIAL");
    expect(r.differing).toEqual(["phone"]);
    expect(r.matched).toEqual(["email","name"]);
  });
});

describe("contact-match classification (required cases)",()=>{
  it("1. full match: formats differ but every field is equal",()=>{
    const r=classifyContactMatch({
      email:"JANE.DOE@example.com ",phone:"+1 561-405-0478",firstName:"jane",lastName:"DOE",
      address:{street:"123 main st",city:"west palm beach",state:"Florida",zip:"33401"}
    },existing,ADDR);
    expect(r.kind).toBe("FULL");
    expect(r.differing).toEqual([]);
    expect(r.matched).toEqual(["email","phone","name","address"]);
  });
  it("2. partial on phone only (different email and name)",()=>{
    const r=classifyContactMatch({...existing,email:"someone.else@example.com",firstName:"John",lastName:"Smith"},existing,ADDR);
    expect(r.kind).toBe("PARTIAL");
    expect(r.matched).toEqual(["phone","address"]);
    expect(r.differing).toEqual(["email","name"]);
    const phoneOnly=classifyContactMatch({email:"other@example.com",phone:"5614050478",name:"John Smith"},existing,{compareAddress:false});
    expect(phoneOnly).toMatchObject({kind:"PARTIAL",matched:["phone"],differing:["email","name"]});
  });
  it("3. partial on email only (different phone and name)",()=>{
    const r=classifyContactMatch({email:existing.email,phone:"3055550100",firstName:"John",lastName:"Smith"},existing,{compareAddress:false});
    expect(r).toMatchObject({kind:"PARTIAL",matched:["email"],differing:["phone","name"]});
  });
  it("4. name mismatch with same email and phone is partial",()=>{
    const r=classifyContactMatch({...existing,firstName:"Janet"},existing,ADDR);
    expect(r).toMatchObject({kind:"PARTIAL",differing:["name"]});
    expect(r.matched).toEqual(["email","phone","address"]);
  });
  it("5. exact resubmit is a full match every time",()=>{
    const payload={...existing};
    expect(classifyContactMatch(payload,existing,ADDR).kind).toBe("FULL");
    expect(classifyContactMatch({...payload},existing,ADDR).kind).toBe("FULL");
  });
  it("none when no non-blank field is equal",()=>{
    expect(classifyContactMatch({email:"b@example.com",phone:"3055550100",name:"Bob Roe"},existing,{compareAddress:false}).kind).toBe("NONE");
  });
  it("builds the possible-duplicate prefix",()=>{
    expect(possibleDuplicateNotePrefix(["phone","name"])).toBe(
      "Possible duplicate: this form submission's phone and full name differ from this contact. Contact properties were not changed."
    );
    expect(possibleDuplicateNotePrefix(["phone","name","address"])).toContain("phone, full name and address differ");
  });
});

const initialBase=[
  {name:"email",value:"jane.doe@example.com"},{name:"firstname",value:"Jane"},{name:"lastname",value:"Doe"},
  {name:"phone",value:"(561) 405-0478"},{name:"service_state",value:"FL"},{name:"case_type",value:"Car accident"}
];
const contact:HubSpotContactIdentity={
  id:"451",email:"jane.doe@example.com",firstName:"Jane",lastName:"Doe",phone:"+15614050478",
  street:"123 Main St",city:"West Palm Beach",state:"FL",zip:"33401"
};
function submit(extra:Array<{name:string;value:string}>=[],override:Record<string,string>={}){
  const values=[...initialBase.map(v=>override[v.name]!==undefined?{...v,value:override[v.name]!}:v),...extra];
  const initial={conversionId:"c1",submittedAt:1,values};
  return{lead:toLead({initial,initialFormGuid:"i",supplementalFormGuid:"s"}),address:submissionContactAddress({initial})};
}
const ADDRESS_FIELDS=[{name:"address",value:"123 Main St."},{name:"city",value:"West Palm Beach"},{name:"state",value:"FL"},{name:"zip",value:"33401"}];
const NOTE="<p>Verdict: 🟢</p><p>Validation ID: v1</p>";

describe("form submission vs found contact (processEmail rule)",()=>{
  it("full match leaves the outcome note unchanged",()=>{
    const {lead,address}=submit(ADDRESS_FIELDS);
    const match=matchFormContact(lead,address,contact);
    expect(match.kind).toBe("FULL");
    expect(formOutcomeNote(NOTE,match)).toEqual({body:NOTE,possibleDuplicate:false});
  });
  it("skips the address comparison when the form did not collect one",()=>{
    const {lead,address}=submit();
    expect(address).toBeUndefined();
    const match=matchFormContact(lead,address,{...contact,street:undefined,city:undefined,state:undefined,zip:undefined});
    expect(match.compared).toEqual(["email","phone","name"]);
    expect(match.kind).toBe("FULL");
  });
  it("email-only match keeps the note and prefixes the possible-duplicate warning",()=>{
    const {lead,address}=submit([],{phone:"305-555-0100",firstname:"John",lastname:"Smith"});
    const match=matchFormContact(lead,address,contact);
    expect(match).toMatchObject({kind:"PARTIAL",matched:["email"],differing:["phone","name"]});
    const note=formOutcomeNote(NOTE,match);
    expect(note.possibleDuplicate).toBe(true);
    expect(note.body.startsWith("<p>Possible duplicate: this form submission's phone and full name differ from this contact.")).toBe(true);
    expect(note.body).toContain("Contact properties were not changed.");
    expect(note.body.endsWith(NOTE)).toBe(true);
  });
  it("flags an address difference",()=>{
    const {lead,address}=submit([...ADDRESS_FIELDS.filter(f=>f.name!=="city"),{name:"city",value:"Tampa"}]);
    const match=matchFormContact(lead,address,contact);
    expect(match).toMatchObject({kind:"PARTIAL",differing:["address"]});
  });
  it("name mismatch with same email and phone is flagged",()=>{
    const {lead,address}=submit([],{firstname:"Janet"});
    expect(matchFormContact(lead,address,{...contact,street:undefined,city:undefined,state:undefined,zip:undefined}).differing).toEqual(["name"]);
  });
});

describe("readContactIdentity",()=>{
  it("reads the identity properties by id with a GET and never writes",async()=>{
    const fetchMock=vi.fn(async(_url:string,_init?:RequestInit)=>new Response(JSON.stringify({id:"451",properties:{
      email:"jane.doe@example.com",firstname:"Jane",lastname:"Doe",phone:"(561) 405-0478",address:"123 Main St",city:"West Palm Beach",state:"FL",zip:"33401"
    }}),{status:200}));
    const identity=await readContactIdentity("451",{fetch:fetchMock as unknown as typeof fetch,accessToken:"pat-test",timeoutMs:5000});
    expect(identity).toEqual({...contact,phone:"(561) 405-0478"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url,init]=fetchMock.mock.calls[0]!;
    expect(url).toContain("/crm/v3/objects/contacts/451?");
    expect(decodeURIComponent(url)).toContain("properties=email,firstname,lastname,phone,address,city,state,zip");
    expect(init?.method??"GET").toBe("GET");
  });
});
