// Advisory-lock names of a parts2world run. The site's rate limit is per egress IP, so runs on the same IP exclude
// each other while a run through the egress proxy (its own IP) may go beside a direct one (#946).
export type Parts2WorldEgress='direct'|'proxy';
export function parts2worldLockNames(egress:Parts2WorldEgress){
 const suffix=egress==='proxy'?':proxy':'';
 return {run:'parts2world-collect'+suffix,source:'parts2world-source'+suffix};
}
