import {describe,it,expect,vi} from "vitest";
import {
  createContactNote,
  createContactNoteWithScreenshots,
  describeHubSpotToken,
  noteCreatePayload,
  privateFileUploadOptions,
  uploadPrivateFile,
  uploadScreenshotFiles
} from "../src/integrations/hubspot/client.js";

function jsonResponse(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

const shot={
  file_name:"official-source-example.com.jpg",
  bytes:Buffer.from([0xff,0xd8,0xff,0xd9]),
  content_type:"image/jpeg"
};

describe("HubSpot note attachments",()=>{
  it("joins attachment ids with semicolons like Abby-Hubspot",()=>{
    const payload=noteCreatePayload("451","⚠️ *CaseClosedFL Validation*",202,["file-1","file-2"]);
    expect(payload.properties.hs_note_body).toContain("<strong>CaseClosedFL Validation</strong>");
    expect(payload.properties.hs_note_body).toContain("<p>");
    expect(payload.properties.hs_attachment_ids).toBe("file-1;file-2");
    expect(payload.associations[0]?.to.id).toBe("451");
    expect(privateFileUploadOptions().access).toBe("PRIVATE");
  });
  it("uploads a private file then creates a note with hs_attachment_ids",async()=>{
    const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
      if(String(url)==="https://api.hubapi.com/files/v3/files"){
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer pat-test");
        expect((init?.headers as Record<string,string>)["Content-Type"]).toBeUndefined();
        expect(init?.body).toBeInstanceOf(FormData);
        const form=init?.body as FormData;
        expect(form.get("fileName")).toBe(shot.file_name);
        expect(String(form.get("options"))).toContain("PRIVATE");
        expect(form.get("folderPath")).toBe("/caseclosedfl-validator");
        return jsonResponse({id:"file-99"});
      }
      if(String(url)==="https://api.hubapi.com/crm/v3/objects/notes"){
        const body=JSON.parse(String(init?.body??"{}"));
        expect(body.properties.hs_note_body).toContain("Validation");
        expect(body.properties.hs_attachment_ids).toBe("file-99");
        return jsonResponse({id:"note-7"});
      }
      throw new Error(`unexpected ${url}`);
    });
    const opts={fetch:fetchMock as unknown as typeof fetch,accessToken:"pat-test",associationTypeId:202,timeoutMs:5000};
    const fileId=await uploadPrivateFile({fileName:shot.file_name,bytes:shot.bytes,contentType:shot.content_type},opts);
    const noteId=await createContactNote("451","⚠️ *CaseClosedFL Validation*\nStatus: *INCOMPLETE*",[fileId],opts);
    expect(fileId).toBe("file-99");
    expect(noteId).toBe("note-7");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("still writes the text note when files upload is rejected for scope",async()=>{
    const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
      if(String(url)==="https://api.hubapi.com/files/v3/files"){
        return jsonResponse({status:"error",message:"MISSING_SCOPES files"},403);
      }
      if(String(url)==="https://api.hubapi.com/crm/v3/objects/notes"){
        const body=JSON.parse(String(init?.body??"{}"));
        expect(body.properties.hs_attachment_ids).toBeUndefined();
        expect(body.properties.hs_note_body).toContain("<strong>CaseClosedFL Validation</strong>");
        return jsonResponse({id:"note-plain"});
      }
      throw new Error(`unexpected ${url}`);
    });
    const opts={fetch:fetchMock as unknown as typeof fetch,accessToken:"pat-test",associationTypeId:202,timeoutMs:5000};
    const uploaded=await uploadScreenshotFiles([shot],opts);
    expect(uploaded.attachmentIds).toEqual([]);
    expect(uploaded.errors[0]).toMatch(/HUBSPOT_403|MISSING_SCOPES/);
    const noteId=await createContactNote("451","⚠️ *CaseClosedFL Validation*",uploaded.attachmentIds,opts);
    expect(noteId).toBe("note-plain");
  });
  it("reports the full required scope list from a 403 MISSING_SCOPES body",async()=>{
    const longMessage=`This app hasn't been granted all required scopes to make this call. Read more about required scopes here: https://developers.hubspot.com/scopes. ${"x".repeat(400)}`;
    const fetchMock=vi.fn(async()=>jsonResponse({
      status:"error",
      message:longMessage,
      correlationId:"c-1",
      errors:[{message:"One or more of the following scopes are required.",context:{requiredGranularScopes:["files","files.ui_hidden.read"]}}],
      category:"MISSING_SCOPES"
    },403));
    const opts={fetch:fetchMock as unknown as typeof fetch,accessToken:"pat-test",timeoutMs:5000};
    await expect(uploadPrivateFile({fileName:shot.file_name,bytes:shot.bytes,contentType:shot.content_type},opts))
      .rejects.toThrow(/^HUBSPOT_403_MISSING_SCOPES:files,files\.ui_hidden\.read$/);
    const uploaded=await uploadScreenshotFiles([shot,shot],opts);
    expect(uploaded.errors).toEqual(["HUBSPOT_403_MISSING_SCOPES:files,files.ui_hidden.read","HUBSPOT_403_MISSING_SCOPES:files,files.ui_hidden.read"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("falls back to scopes listed in the 403 message",async()=>{
    const fetchMock=vi.fn(async()=>jsonResponse({
      status:"error",
      message:"This app hasn't been granted all required scopes to make this call. All of the following scopes are required: [files, files.ui_hidden.read]",
      category:"MISSING_SCOPES"
    },403));
    const opts={fetch:fetchMock as unknown as typeof fetch,accessToken:"pat-test",timeoutMs:5000};
    await expect(uploadPrivateFile({fileName:shot.file_name,bytes:shot.bytes,contentType:shot.content_type},opts))
      .rejects.toThrow(/^HUBSPOT_403_MISSING_SCOPES:files,files\.ui_hidden\.read$/);
  });
  it("keeps the HUBSPOT_<status>:<body> format for other failures",async()=>{
    const body={status:"error",message:"Internal error",category:"INTERNAL_ERROR"};
    for(const status of [500,400,403]){
      const fetchMock=vi.fn(async()=>jsonResponse(body,status));
      const opts={fetch:fetchMock as unknown as typeof fetch,accessToken:"pat-test",timeoutMs:5000};
      await expect(uploadPrivateFile({fileName:shot.file_name,bytes:shot.bytes,contentType:shot.content_type},opts))
        .rejects.toThrow(`HUBSPOT_${status}:${JSON.stringify(body)}`);
    }
  });
  it("describeHubSpotToken returns app, hub, user, and scopes without the token",async()=>{
    const token="pat-na1-secret-token";
    const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
      expect(String(url)).toBe("https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string,string>).Authorization).toBeUndefined();
      expect(JSON.parse(String(init?.body))).toEqual({tokenKey:token});
      return jsonResponse({tokenKey:token,appId:1234,hubId:5678,userId:91,scopes:["crm.objects.contacts.read","files"]});
    });
    const info=await describeHubSpotToken({fetch:fetchMock as unknown as typeof fetch,accessToken:token,timeoutMs:1000});
    expect(info).toEqual({appId:1234,hubId:5678,userId:91,scopes:["crm.objects.contacts.read","files"]});
    expect(JSON.stringify(info)).not.toContain(token);
  });
  it("describeHubSpotToken returns null on HTTP errors, thrown fetch, or no token",async()=>{
    const denied=vi.fn(async()=>jsonResponse({message:"bad token"},401));
    expect(await describeHubSpotToken({fetch:denied as unknown as typeof fetch,accessToken:"pat-x",timeoutMs:1000})).toBeNull();
    const broken=vi.fn(async()=>{throw new Error("network down pat-x");});
    expect(await describeHubSpotToken({fetch:broken as unknown as typeof fetch,accessToken:"pat-x",timeoutMs:1000})).toBeNull();
    const unused=vi.fn();
    expect(await describeHubSpotToken({fetch:unused as unknown as typeof fetch,accessToken:"",timeoutMs:1000})).toBeNull();
  });
  it("createContactNoteWithScreenshots writes the note when listing screenshots fails",async()=>{
    const fetchMock=vi.fn(async(url:string)=>{
      if(String(url)==="https://api.hubapi.com/crm/v3/objects/notes"){
        return jsonResponse({id:"note-fallback"});
      }
      throw new Error(`unexpected ${url}`);
    });
    const written=await createContactNoteWithScreenshots(
      "451",
      "⚠️ *CaseClosedFL Validation*",
      undefined,
      {fetch:fetchMock as unknown as typeof fetch,accessToken:"pat-test",associationTypeId:202,timeoutMs:5000}
    );
    expect(written.noteId).toBe("note-fallback");
    expect(written.attachmentIds).toEqual([]);
    expect(written.uploadErrors).toEqual([]);
  });
});
