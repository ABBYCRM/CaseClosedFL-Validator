import {describe,expect,it,vi} from "vitest";
import {readContacts} from "../src/integrations/hubspot/client.js";

const CANONICAL=["trustedform_cert_url","trustedform_ping_url","trustedform_retain_status","trustedform_retain_expires_at","trustedform_retain_result"];
const cert="https://cert.trustedform.com/454a35b802f3e7b63ffabb4efedb7c6ebe67886c";
const ping="https://ping.trustedform.com/454a35b802f3e7b63ffabb4efedb7c6ebe67886c";
const stored:Record<string,string>={
  email:"paisabrazilfl@gmail.com",
  firstname:"Paisa",
  trustedform_cert_url:cert,
  xxtrustedformcerturl:cert,
  trustedform_ping_url:ping,
  xxtrustedformpingurl:ping,
  trustedform_retain_status:"SUCCESS",
  trustedform_retain_expires_at:"2029-10-02",
  trustedform_retain_result:"TrustedForm cert retained, expires October 2, 2029."
};

function jsonResponse(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}
function propertiesFrom(init?:RequestInit){
  return JSON.parse(String(init?.body??"{}")).properties as string[];
}
function contactRow(requested:string[],source:Record<string,string>=stored){
  const properties:Record<string,string>={};
  for(const [key,value] of Object.entries(source)){
    if(requested.includes(key)) properties[key]=value;
  }
  return {id:"451",properties};
}
function optsFor(fetchMock:ReturnType<typeof vi.fn>){
  return {fetch:fetchMock as unknown as typeof fetch,accessToken:"pat-test",timeoutMs:5000};
}

describe("HubSpot contact TrustedForm properties",()=>{
  it("requests every TrustedForm property and keeps sibling fields when one value is absent",async()=>{
    const source:Record<string,string>={...stored};
    delete source.trustedform_retain_expires_at;
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const requested=propertiesFrom(init);
      expect(requested).toEqual(expect.arrayContaining(CANONICAL));
      return jsonResponse({results:[contactRow(requested,source)]});
    });
    const contacts=await readContacts(["451"],optsFor(fetchMock));
    const contact=contacts.get("451");
    expect(contact?.trustedFormCertUrl).toBe(cert);
    expect(contact?.trustedFormPingUrl).toBe(ping);
    expect(contact?.trustedFormRetainStatus).toBe("SUCCESS");
    expect(contact?.trustedFormRetainExpiresAt).toBeUndefined();
    expect(contact?.trustedFormRetainResult).toBe(stored.trustedform_retain_result);
    expect(contact?.email).toBe("paisabrazilfl@gmail.com");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads the ActiveProspect alias without dropping canonical retain fields",async()=>{
    const source:Record<string,string>={...stored};
    delete source.trustedform_cert_url;
    delete source.trustedform_ping_url;
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      return jsonResponse({results:[contactRow(propertiesFrom(init),source)]});
    });
    const contacts=await readContacts(["451"],optsFor(fetchMock));
    const contact=contacts.get("451");
    expect(contact?.trustedFormCertUrl).toBe(cert);
    expect(contact?.trustedFormPingUrl).toBe(ping);
    expect(contact?.trustedFormRetainStatus).toBe("SUCCESS");
    expect(contact?.trustedFormRetainExpiresAt).toBe("2029-10-02");
    expect(contact?.trustedFormRetainResult).toBe(stored.trustedform_retain_result);
  });

  it("drops only the rejected property and retries with the other TrustedForm fields",async()=>{
    const seen:string[][]=[];
    const missing=["xxtrustedformcerturl","xxtrustedformpingurl"];
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const requested=propertiesFrom(init);
      seen.push(requested);
      const rejected=missing.find(name=>requested.includes(name));
      if(rejected){
        return jsonResponse({
          status:"error",
          message:`Property "${rejected}" does not exist`,
          correlationId:"abc",
          errors:[{message:`Property "${rejected}" does not exist`,error:"PROPERTY_DOESNT_EXIST",name:rejected}]
        },400);
      }
      return jsonResponse({results:[contactRow(requested)]});
    });
    const contacts=await readContacts(["451"],optsFor(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const final=seen[seen.length-1]??[];
    expect(final).toEqual(expect.arrayContaining(CANONICAL));
    expect(final).not.toEqual(expect.arrayContaining(missing));
    expect(seen[1]).toEqual(expect.arrayContaining(CANONICAL));
    expect(seen[1]).not.toContain("xxtrustedformcerturl");
    expect(seen[1]).toContain("xxtrustedformpingurl");
    const contact=contacts.get("451");
    expect(contact?.trustedFormCertUrl).toBe(cert);
    expect(contact?.trustedFormPingUrl).toBe(ping);
    expect(contact?.trustedFormRetainStatus).toBe("SUCCESS");
    expect(contact?.trustedFormRetainExpiresAt).toBe("2029-10-02");
    expect(contact?.trustedFormRetainResult).toBe(stored.trustedform_retain_result);
    expect(contact?.email).toBe("paisabrazilfl@gmail.com");
  });

  it("removes every named missing property in one error without dropping the rest",async()=>{
    const seen:string[][]=[];
    const missing=["xxtrustedformcerturl","trustedform_retain_result"];
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const requested=propertiesFrom(init);
      seen.push(requested);
      const rejected=missing.filter(name=>requested.includes(name));
      if(rejected.length){
        return jsonResponse({
          status:"error",
          message:"There was a problem with the request.",
          correlationId:"abc",
          errors:rejected.map(name=>({message:`Property "${name}" does not exist`,error:"PROPERTY_DOESNT_EXIST",name}))
        },400);
      }
      return jsonResponse({results:[contactRow(requested)]});
    });
    const contacts=await readContacts(["451"],optsFor(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const final=seen[1]??[];
    expect(final).toEqual(expect.arrayContaining(["trustedform_cert_url","trustedform_ping_url","trustedform_retain_status","trustedform_retain_expires_at"]));
    expect(final).not.toEqual(expect.arrayContaining(missing));
    const contact=contacts.get("451");
    expect(contact?.trustedFormCertUrl).toBe(cert);
    expect(contact?.trustedFormPingUrl).toBe(ping);
    expect(contact?.trustedFormRetainStatus).toBe("SUCCESS");
    expect(contact?.trustedFormRetainExpiresAt).toBe("2029-10-02");
    expect(contact?.trustedFormRetainResult).toBeUndefined();
    expect(contact?.email).toBe("paisabrazilfl@gmail.com");
  });

  it("isolates an unnamed rejection so the other TrustedForm fields are still read",async()=>{
    const seen:string[][]=[];
    const missing=new Set(["xxtrustedformcerturl","xxtrustedformpingurl"]);
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const requested=propertiesFrom(init);
      seen.push(requested);
      if(requested.some(name=>missing.has(name))){
        return jsonResponse({status:"error",message:"Some properties do not exist"},400);
      }
      return jsonResponse({results:[contactRow(requested)]});
    });
    const contacts=await readContacts(["451"],optsFor(fetchMock));
    const final=seen[seen.length-1]??[];
    expect(final).toEqual(expect.arrayContaining(CANONICAL));
    expect(final).not.toEqual(expect.arrayContaining([...missing]));
    const contact=contacts.get("451");
    expect(contact?.trustedFormCertUrl).toBe(cert);
    expect(contact?.trustedFormPingUrl).toBe(ping);
    expect(contact?.trustedFormRetainStatus).toBe("SUCCESS");
    expect(contact?.trustedFormRetainExpiresAt).toBe("2029-10-02");
    expect(contact?.trustedFormRetainResult).toBe(stored.trustedform_retain_result);
  });

  it("does not retry when HubSpot rejects the batch for a reason other than an unknown property",async()=>{
    const fetchMock=vi.fn(async()=>jsonResponse({message:"Property values were not valid"},400));
    await expect(readContacts(["451"],optsFor(fetchMock))).rejects.toThrow(/Property values were not valid/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not drop TrustedForm fields when a base property is the one HubSpot rejects",async()=>{
    const fetchMock=vi.fn(async()=>jsonResponse({message:'Property "email" does not exist'},400));
    await expect(readContacts(["451"],optsFor(fetchMock))).rejects.toThrow(/email/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty map without calling HubSpot when there are no contacts",async()=>{
    const fetchMock=vi.fn();
    const contacts=await readContacts([],optsFor(fetchMock));
    expect(contacts.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
