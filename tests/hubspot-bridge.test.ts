import {describe,it,expect} from "vitest";
import {uniqueHubSpotContactId} from "../src/integrations/hubspot/client.js";
import {PENDING_EMAILS_SQL,resolveFormId} from "../src/integrations/hubspot/worker.js";

describe("HubSpot contact lookup",()=>{
  it("returns the only matching contact",()=>{
    expect(uniqueHubSpotContactId({results:[{id:"123"}]})).toBe("123");
  });
  it("fails closed when no contact matches",()=>{
    expect(uniqueHubSpotContactId({results:[]})).toBeNull();
    expect(uniqueHubSpotContactId({})).toBeNull();
  });
  it("fails closed when more than one contact matches",()=>{
    expect(uniqueHubSpotContactId({results:[{id:"123"},{id:"456"}]})).toBeNull();
  });
});

describe("HubSpot form allowlist",()=>{
  const forms=[{id:"guid-initial",name:"Initial Intake"},{id:"guid-email",name:"Email Followup"},{id:"guid-old",name:"Initial Intake",archived:true}];
  it("uses an explicit GUID without listing forms",()=>{
    expect(resolveFormId({id:"guid-initial",forms:[],role:"initial"})).toBe("guid-initial");
  });
  it("resolves a unique active name",()=>{
    expect(resolveFormId({name:"initial intake",forms,role:"initial"})).toBe("guid-initial");
  });
  it("allows mixing a GUID for one form with a name for the other",()=>{
    expect(resolveFormId({id:"guid-initial",forms,role:"initial"})).toBe("guid-initial");
    expect(resolveFormId({name:"Email Followup",forms,role:"supplemental"})).toBe("guid-email");
  });
  it("fails closed when a name is missing or not unique",()=>{
    expect(()=>resolveFormId({forms,role:"initial"})).toThrow(/HUBSPOT_FORM_ALLOWLIST_UNRESOLVED:initial=0/);
    expect(()=>resolveFormId({name:"Missing",forms,role:"supplemental"})).toThrow(/HUBSPOT_FORM_ALLOWLIST_UNRESOLVED:supplemental=0/);
  });
});

describe("HubSpot pending queue",()=>{
  it("requires an initial-form submission before occupying the batch",()=>{
    expect(PENDING_EMAILS_SQL).toMatch(/EXISTS/);
    expect(PENDING_EMAILS_SQL).toMatch(/i\.form_guid=\$1/);
    expect(PENDING_EMAILS_SQL).toMatch(/s\.form_guid IN \(\$1,\$2\)/);
  });
});
