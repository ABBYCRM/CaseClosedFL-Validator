// The v4 retain `expires_at` is only the end of the lookup/claim window (72 hours, or 90 days if a form
// submission was recorded). The retained copy is stored for the account retention period (5 years by default).
export const TRUSTEDFORM_RETAINED_SENTENCE="TrustedForm cert retained (stored 5 years).";

const LEGACY_RETAINED_WITH_DATE=/TrustedForm cert retained, expires ([^.]+)\./g;
const LEGACY_RETAINED_BARE=/TrustedForm cert retained\.(?!\s*\(stored)/g;

export function modernizeTrustedFormRetainSentence(value?:string|null){
  return String(value??"")
    .replace(LEGACY_RETAINED_WITH_DATE,(_m,date:string)=>`${TRUSTEDFORM_RETAINED_SENTENCE} Lookup/claim window ends ${date}.`)
    .replace(LEGACY_RETAINED_BARE,TRUSTEDFORM_RETAINED_SENTENCE);
}
