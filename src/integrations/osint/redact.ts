export function redactEmail(email:string):string{
  const trimmed=email.trim();
  const at=trimmed.indexOf("@");
  if(at<=0||at===trimmed.length-1) return "[redacted-email]";
  const local=trimmed.slice(0,at);
  const domain=trimmed.slice(at+1);
  const keep=local.slice(0,1);
  return `${keep}***@${domain}`;
}

export function redactPhone(phone:string):string{
  const trimmed=phone.trim();
  const digits=trimmed.replace(/\D/g,"");
  if(digits.length<4) return "[redacted-phone]";
  const prefix=trimmed.startsWith("+")?"+":"";
  return `${prefix}***${digits.slice(-4)}`;
}

export function isLikelyEmail(value:string):boolean{
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function normalizePhone(value:string):string|undefined{
  const trimmed=value.trim();
  if(!trimmed||/[\s@]|[a-z]/i.test(trimmed.replace(/[\s().+\-]/g,""))) return undefined;
  const compact=trimmed.replace(/[^\d+]/g,"");
  const digits=compact.replace(/\D/g,"");
  if(digits.length<8||digits.length>15) return undefined;
  if(compact.startsWith("+")) return `+${digits}`;
  return digits;
}

/** Drop password/hash material that breach CLIs may print. Never persist secrets. */
export function stripSecretPairs(text:string):string{
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+\s*[:|;]\s*\S+/g,"[credential-pair-redacted]")
    .replace(/\b[a-f0-9]{32,}\b/gi,"[hash-redacted]");
}
