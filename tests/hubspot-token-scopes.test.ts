import {afterEach,describe,expect,it,vi} from "vitest";
import {env} from "../src/config/env.js";
import {logHubSpotTokenScopes,startHubSpotWorker} from "../src/integrations/hubspot/worker.js";

const token="pat-na1-worker-secret";
const original={enabled:env.HUBSPOT_SYNC_ENABLED,token:env.HUBSPOT_ACCESS_TOKEN};

function jsonResponse(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

afterEach(()=>{
  env.HUBSPOT_SYNC_ENABLED=original.enabled;
  env.HUBSPOT_ACCESS_TOKEN=original.token;
});

describe("HubSpot token scope startup log",()=>{
  it("logs app, hub, scopes, and whether screenshot uploads are allowed, never the token",async()=>{
    env.HUBSPOT_ACCESS_TOKEN=token;
    const fetchMock=vi.fn(async()=>jsonResponse({tokenKey:token,appId:11,hubId:22,userId:33,scopes:["crm.objects.notes.write"]}));
    const log=vi.fn();
    await logHubSpotTokenScopes(log,{fetch:fetchMock as unknown as typeof fetch});
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({
      hubspot_app_id:11,
      hubspot_hub_id:22,
      scopes:["crm.objects.notes.write"],
      screenshot_upload_scope_ok:false
    },"HubSpot token scopes");
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });
  it("reports screenshot_upload_scope_ok when files is granted",async()=>{
    env.HUBSPOT_ACCESS_TOKEN=token;
    const fetchMock=vi.fn(async()=>jsonResponse({appId:11,hubId:22,userId:33,scopes:["files"]}));
    const log=vi.fn();
    await logHubSpotTokenScopes(log,{fetch:fetchMock as unknown as typeof fetch});
    expect(log.mock.calls[0]?.[0]).toMatchObject({screenshot_upload_scope_ok:true});
  });
  it("is fail-soft when the lookup or the logger throws",async()=>{
    env.HUBSPOT_ACCESS_TOKEN=token;
    const broken=vi.fn(async()=>{throw new Error("network down");});
    const log=vi.fn();
    await expect(logHubSpotTokenScopes(log,{fetch:broken as unknown as typeof fetch})).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith({},"HubSpot token scopes unavailable");
    const throwingLog=vi.fn(()=>{throw new Error("logger down");});
    await expect(logHubSpotTokenScopes(throwingLog,{fetch:broken as unknown as typeof fetch})).resolves.toBeUndefined();
  });
  it("skips the lookup when no token is configured",async()=>{
    env.HUBSPOT_ACCESS_TOKEN="";
    const fetchMock=vi.fn();
    const log=vi.fn();
    await logHubSpotTokenScopes(log,{fetch:fetchMock as unknown as typeof fetch});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
  it("does not look up the token when HubSpot sync is disabled",()=>{
    env.HUBSPOT_SYNC_ENABLED=false;
    env.HUBSPOT_ACCESS_TOKEN=token;
    const fetchMock=vi.fn();
    const stop=startHubSpotWorker(vi.fn(),{fetch:fetchMock as unknown as typeof fetch});
    stop();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
