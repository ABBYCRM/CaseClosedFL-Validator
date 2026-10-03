import {describe,expect,it,vi} from "vitest";
import {
  classifyContactMatch,normalizeEmail,normalizePhone,possibleDuplicateNotePrefix,type MatchRecord
} from "../src/integrations/hubspot/contact-match.js";
import {readContactIdentity,type HubSpotContactIdentity} from "../src/integrations/hubspot/client.js";
import {toLead} from "../src/integrations/hubspot/mapper.js";
import {formOutcomeNote,matchFormContact} from "../src/integrations/hubspot/worker.js";

const existing:MatchRecord={email:"jane.doe@example.com",phone:"(561) 405-0478"};

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
  it("treats blank on both sides as equal and blank on one side as different",()=>{
    const phoneOnly={phone:"5614050478"};
    expect(classifyContactMatch(phoneOnly,{phone:"(561) 405-0478"})).toMatchObject({kind:"FULL",matched:["phone"],differing:[]});
    const r=classifyContactMatch({email:"x@example.com",phone:"5614050478"},{email:"x@example.com"});
    expect(r).toMatchObject({kind:"PARTIAL",matched:["email"],differing:["phone"]});
  });
  it("compares only email and phone",()=>{
    expect(classifyContactMatch(existing,existing).compared).toEqual(["email","phone"]);
  });
});

describe("contact-match classification (required cases)",()=>{
  it("1. full match: same email + same phone in different formats",()=>{
    const r=classifyContactMatch({email:"JANE.DOE@example.com ",phone:"+1 561-405-0478"},existing);
    expect(r).toMatchObject({kind:"FULL",matched:["email","phone"],differing:[]});
  });
  it("2. partial on phone only (different email)",()=>{
    const r=classifyContactMatch({email:"someone.else@example.com",phone:"5614050478"},existing);
    expect(r).toMatchObject({kind:"PARTIAL",matched:["phone"],differing:["email"]});
  });
  it("3. partial on email only (different phone)",()=>{
    const r=classifyContactMatch({email:existing.email,phone:"3055550100"},existing);
    expect(r).toMatchObject({kind:"PARTIAL",matched:["email"],differing:["phone"]});
  });
  it("4. name mismatch with same email + same phone is a full match",()=>{
    const r=classifyContactMatch({...existing,firstName:"Luis",lastName:"Lacerda"} as MatchRecord,{...existing,firstName:"Jane",lastName:"Doe"} as MatchRecord);
    expect(r).toMatchObject({kind:"FULL",differing:[]});
  });
  it("5. exact resubmit is a full match every time",()=>{
    const payload={...existing};
    expect(classifyContactMatch(payload,existing).kind).toBe("FULL");
    expect(classifyContactMatch({...payload},existing).kind).toBe("FULL");
  });
  it("none when neither email nor phone is equal",()=>{
    expect(classifyContactMatch({email:"b@example.com",phone:"3055550100"},existing).kind).toBe("NONE");
  });
  it("builds the possible-duplicate prefix",()=>{
    expect(possibleDuplicateNotePrefix(["phone"])).toBe(
      "Possible duplicate: this form submission's phone differ from this contact. Contact properties were not changed."
    );
    expect(possibleDuplicateNotePrefix(["email","phone"])).toContain("email and phone differ");
  });
});

const initialBase=[
  {name:"email",value:"jane.doe@example.com"},{name:"firstname",value:"Jane"},{name:"lastname",value:"Doe"},
  {name:"phone",value:"(561) 405-0478"},{name:"service_state",value:"FL"},{name:"case_type",value:"Car accident"}
];
const contact:HubSpotContactIdentity={id:"451",email:"jane.doe@example.com",phone:"+15614050478"};
function submit(extra:Array<{name:string;value:string}>=[],override:Record<string,string>={}){
  const values=[...initialBase.map(v=>override[v.name]!==undefined?{...v,value:override[v.name]!}:v),...extra];
  const initial={conversionId:"c1",submittedAt:1,values};
  return toLead({initial,initialFormGuid:"i",supplementalFormGuid:"s"});
}
const NOTE="<p>Verdict: 🟢</p><p>Validation ID: v1</p>";

describe("form submission vs found contact (processEmail rule)",()=>{
  it("full match leaves the outcome note unchanged",()=>{
    const match=matchFormContact(submit(),contact);
    expect(match).toMatchObject({kind:"FULL",compared:["email","phone"]});
    expect(formOutcomeNote(NOTE,match)).toEqual({body:NOTE,possibleDuplicate:false});
  });
  it("email-only match keeps the note and prefixes the possible-duplicate warning",()=>{
    const match=matchFormContact(submit([],{phone:"305-555-0100"}),contact);
    expect(match).toMatchObject({kind:"PARTIAL",matched:["email"],differing:["phone"]});
    const note=formOutcomeNote(NOTE,match);
    expect(note.possibleDuplicate).toBe(true);
    expect(note.body.startsWith("<p>Possible duplicate: this form submission's phone differ from this contact.")).toBe(true);
    expect(note.body).toContain("Contact properties were not changed.");
    expect(note.body.endsWith(NOTE)).toBe(true);
  });
  it("name mismatch with same email and phone is a full match (no flag)",()=>{
    const match=matchFormContact(submit([],{firstname:"Luis",lastname:"Lacerda"}),contact);
    expect(match.kind).toBe("FULL");
    expect(formOutcomeNote(NOTE,match).possibleDuplicate).toBe(false);
  });
  it("different address/ZIP with same email and phone is a full match",()=>{
    const lead=submit([{name:"address",value:"9 Other Rd"},{name:"city",value:"Tampa"},{name:"state",value:"FL"},{name:"zip",value:"33602"}]);
    expect(matchFormContact(lead,contact).kind).toBe("FULL");
  });
  it("exact resubmit stays a full match",()=>{
    expect(matchFormContact(submit(),contact).kind).toBe("FULL");
    expect(matchFormContact(submit(),contact).kind).toBe("FULL");
  });
});

describe("readContactIdentity",()=>{
  it("reads email + phone by id with a GET and never writes",async()=>{
    const fetchMock=vi.fn(async(_url:string,_init?:RequestInit)=>new Response(JSON.stringify({id:"451",properties:{
      email:"jane.doe@example.com",phone:"(561) 405-0478"
    }}),{status:200}));
    const identity=await readContactIdentity("451",{fetch:fetchMock as unknown as typeof fetch,accessToken:"pat-test",timeoutMs:5000});
    expect(identity).toEqual({...contact,phone:"(561) 405-0478"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url,init]=fetchMock.mock.calls[0]!;
    expect(url).toContain("/crm/v3/objects/contacts/451?");
    expect(decodeURIComponent(url)).toContain("properties=email,phone");
    expect(init?.method??"GET").toBe("GET");
  });
});
