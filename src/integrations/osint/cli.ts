import {spawn} from "node:child_process";
import {accessSync,constants} from "node:fs";
import {delimiter,isAbsolute} from "node:path";
import {keyed,type OsintConfig} from "./config.js";
import type {OsintProvider} from "./types.js";

export interface CliResult{
  command:string;
  args:string[];
  code:number|null;
  stdout:string;
  stderr:string;
  timedOut:boolean;
  error?:string;
}

export interface ResolvedCommand{
  command:string;
  prefixArgs:string[];
  via:"bin"|"docker";
}

export type RunCli=(command:string,args:string[],opts:{timeoutMs:number})=>Promise<CliResult>;
export type ResolveTool=(provider:OsintProvider,cfg:OsintConfig)=>ResolvedCommand|undefined;

const BIN_DEFAULT:Record<OsintProvider,keyof OsintConfig>={
  holehe:"HOLEHE_BIN",
  phoneinfoga:"PHONEINFOGA_BIN",
  mosint:"MOSINT_BIN",
  h8mail:"H8MAIL_BIN"
};

const DOCKER_DEFAULT:Record<OsintProvider,keyof OsintConfig>={
  holehe:"HOLEHE_DOCKER_IMAGE",
  phoneinfoga:"PHONEINFOGA_DOCKER_IMAGE",
  mosint:"MOSINT_DOCKER_IMAGE",
  h8mail:"H8MAIL_DOCKER_IMAGE"
};

export function commandExists(bin:string,pathEnv=process.env.PATH??""):boolean{
  if(!bin.trim()) return false;
  if(isAbsolute(bin)||bin.includes("/")||bin.includes("\\")){
    try{accessSync(bin,constants.X_OK);return true;}catch{return false;}
  }
  for(const dir of pathEnv.split(delimiter)){
    if(!dir) continue;
    try{accessSync(`${dir}/${bin}`,constants.X_OK);return true;}catch{/* next */}
  }
  return false;
}

export function resolveTool(provider:OsintProvider,cfg:OsintConfig):ResolvedCommand|undefined{
  const bin=String(cfg[BIN_DEFAULT[provider]]??provider);
  if(commandExists(bin)) return {command:bin,prefixArgs:[],via:"bin"};
  const image=String(cfg[DOCKER_DEFAULT[provider]]||cfg.OSINT_DOCKER_IMAGE||"");
  if(keyed(image)&&commandExists("docker")){
    return {command:"docker",prefixArgs:["run","--rm","--init","--entrypoint",bin,image],via:"docker"};
  }
  return undefined;
}

export function stripAnsi(text:string){
  return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g,"").replace(/\r/g,"");
}

export async function runCli(command:string,args:string[],opts:{timeoutMs:number}):Promise<CliResult>{
  return new Promise(resolve=>{
    let stdout="";
    let stderr="";
    let timedOut=false;
    let settled=false;
    const finish=(extra:Partial<CliResult>={})=>{
      if(settled) return;
      settled=true;
      resolve({
        command,
        args,
        code:extra.code??null,
        stdout:stripAnsi(stdout).slice(0,200_000),
        stderr:stripAnsi(stderr).slice(0,20_000),
        timedOut,
        error:extra.error
      });
    };
    let child:ReturnType<typeof spawn>;
    try{
      child=spawn(command,args,{stdio:["ignore","pipe","pipe"]});
    }catch(e:any){
      finish({code:null,error:e?.message??"SPAWN_FAILED"});
      return;
    }
    const timer=setTimeout(()=>{
      timedOut=true;
      child.kill("SIGKILL");
    },opts.timeoutMs);
    child.stdout?.on("data",chunk=>{stdout+=String(chunk);});
    child.stderr?.on("data",chunk=>{stderr+=String(chunk);});
    child.on("error",err=>{
      clearTimeout(timer);
      finish({code:null,error:err.message});
    });
    child.on("close",code=>{
      clearTimeout(timer);
      finish({code,error:timedOut?"OSINT_CLI_TIMEOUT":undefined});
    });
  });
}

export function unavailableResult(provider:OsintProvider,capability:import("./types.js").OsintAdapterResult["capability"],targetType:import("./types.js").OsintTargetType,reason:string,redacted?:string):import("./types.js").OsintAdapterResult{
  return{
    provider,
    capability,
    status:"UNAVAILABLE",
    target_type:targetType,
    target_redacted:redacted,
    findings:[],
    errors:[],
    unavailable_reason:reason,
    checks_performed:[]
  };
}

export function skippedResult(provider:OsintProvider,capability:import("./types.js").OsintAdapterResult["capability"],targetType:import("./types.js").OsintTargetType,reason:string):import("./types.js").OsintAdapterResult{
  return{
    provider,
    capability,
    status:"SKIPPED",
    target_type:targetType,
    findings:[],
    errors:[],
    unavailable_reason:reason,
    checks_performed:[]
  };
}

export function errorResult(provider:OsintProvider,capability:import("./types.js").OsintAdapterResult["capability"],targetType:import("./types.js").OsintTargetType,message:string,redacted?:string):import("./types.js").OsintAdapterResult{
  return{
    provider,
    capability,
    status:"ERROR",
    target_type:targetType,
    target_redacted:redacted,
    findings:[],
    errors:[message],
    checks_performed:[]
  };
}
