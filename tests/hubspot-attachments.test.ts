import {describe,it,expect,vi} from "vitest";
import {
  createContactNote,
  createContactNoteWithScreenshots,
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
