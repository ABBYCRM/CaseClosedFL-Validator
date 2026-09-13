export interface OsintConfig{
  OSINT_IDENTITY_ENABLED:boolean;
  OSINT_TIMEOUT_MS:number;
  OSINT_DOCKER_IMAGE:string;
  HOLEHE_BIN:string;
  HOLEHE_DOCKER_IMAGE:string;
  HOLEHE_ONLY_USED:boolean;
  HOLEHE_TIMEOUT_MS:number;
  PHONEINFOGA_BIN:string;
  PHONEINFOGA_DOCKER_IMAGE:string;
  PHONEINFOGA_TIMEOUT_MS:number;
  MOSINT_BIN:string;
  MOSINT_DOCKER_IMAGE:string;
  MOSINT_TIMEOUT_MS:number;
  H8MAIL_BIN:string;
  H8MAIL_DOCKER_IMAGE:string;
  H8MAIL_LOCAL_BREACH_PATH:string;
  H8MAIL_TIMEOUT_MS:number;
  COURTLISTENER_ENABLED:boolean;
  COURTLISTENER_API_TOKEN:string;
  COURTLISTENER_BASE_URL:string;
  COURTLISTENER_TIMEOUT_MS:number;
}

function num(value:unknown,fallback:number){
  const n=Number(value);
  return Number.isFinite(n)&&n>0?Math.round(n):fallback;
}

function str(value:unknown,fallback=""){
  return typeof value==="string"?value.trim():fallback;
}

function bool(value:unknown,fallback=false){
  if(typeof value==="boolean") return value;
  if(typeof value==="string") return value.toLowerCase()==="true";
  return fallback;
}

export function osintConfigFrom(source:Record<string,unknown>|NodeJS.ProcessEnv):OsintConfig{
  const timeout=num(source.OSINT_TIMEOUT_MS,25_000);
  return{
    OSINT_IDENTITY_ENABLED:bool(source.OSINT_IDENTITY_ENABLED,false),
    OSINT_TIMEOUT_MS:timeout,
    OSINT_DOCKER_IMAGE:str(source.OSINT_DOCKER_IMAGE),
    HOLEHE_BIN:str(source.HOLEHE_BIN,"holehe"),
    HOLEHE_DOCKER_IMAGE:str(source.HOLEHE_DOCKER_IMAGE),
    HOLEHE_ONLY_USED:source.HOLEHE_ONLY_USED===undefined?true:bool(source.HOLEHE_ONLY_USED,true),
    HOLEHE_TIMEOUT_MS:num(source.HOLEHE_TIMEOUT_MS,timeout),
    PHONEINFOGA_BIN:str(source.PHONEINFOGA_BIN,"phoneinfoga"),
    PHONEINFOGA_DOCKER_IMAGE:str(source.PHONEINFOGA_DOCKER_IMAGE),
    PHONEINFOGA_TIMEOUT_MS:num(source.PHONEINFOGA_TIMEOUT_MS,timeout),
    MOSINT_BIN:str(source.MOSINT_BIN,"mosint"),
    MOSINT_DOCKER_IMAGE:str(source.MOSINT_DOCKER_IMAGE),
    MOSINT_TIMEOUT_MS:num(source.MOSINT_TIMEOUT_MS,timeout),
    H8MAIL_BIN:str(source.H8MAIL_BIN,"h8mail"),
    H8MAIL_DOCKER_IMAGE:str(source.H8MAIL_DOCKER_IMAGE),
    H8MAIL_LOCAL_BREACH_PATH:str(source.H8MAIL_LOCAL_BREACH_PATH),
    H8MAIL_TIMEOUT_MS:num(source.H8MAIL_TIMEOUT_MS,timeout),
    COURTLISTENER_ENABLED:bool(source.COURTLISTENER_ENABLED,false),
    COURTLISTENER_API_TOKEN:str(source.COURTLISTENER_API_TOKEN),
    COURTLISTENER_BASE_URL:str(source.COURTLISTENER_BASE_URL,"https://www.courtlistener.com/api/rest/v4"),
    COURTLISTENER_TIMEOUT_MS:num(source.COURTLISTENER_TIMEOUT_MS,12_000)
  };
}

export function keyed(value?:string){
  return typeof value==="string"&&value.trim().length>0;
}
