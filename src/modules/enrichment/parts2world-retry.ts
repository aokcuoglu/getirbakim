/** Checkpoint rule for articles parts2world answers with HTTP 529 (#1469): the first one is an error that the next
 *  pass asks again, the second is final (not_found). Pure helpers plus the per-row job check of a collect pass. */
type Tried={outcome:string;error?:string};
export const names529=(entry?:Tried)=>/\bHTTP 529\b/.test(entry?.error||'');
/** Whether a row still needs a request. Without retry a row is open when no checkpoint (own or the other egress's)
 *  has it, or when every entry it has is a 529 error; with retry anything not yet imported is open. */
export function openRow(own:Tried|undefined,other:Tried|undefined,retry:boolean){
 if(retry)return own?.outcome!=='imported';
 return [own,other].every(entry=>!entry||(entry.outcome==='error'&&names529(entry)));
}
/** A 529 was already recorded for the row in either checkpoint, whatever its outcome. */
export const seen529=(own?:Tried,other?:Tried)=>names529(own)||names529(other);
/** The checkpoint entry for a 529: the first stays an error, the second is final. */
export function unavailableEntry(message:string,seenBefore:boolean):{outcome:'not_found'|'error';error:string}{
 return seenBefore
  ?{outcome:'not_found',error:`${message}; second HTTP 529, article unavailable at parts2world`}
  :{outcome:'error',error:`Error: ${message}`};
}
/** A pass's row is still worth a request: its job is open and no parts2world attempt other than a block was
 *  recorded since the pass started, so a row the other egress's worker tried during the run costs nothing. */
export const rowStillOpenSql=`SELECT 1 FROM product_enrichment_jobs j WHERE j.supplier_item_id=$1 AND j.status=$2 AND NOT EXISTS(SELECT 1 FROM enrichment_source_attempts a WHERE a.supplier_item_id=j.supplier_item_id AND a.source='parts2world' AND a.outcome<>'blocked' AND a.attempted_at>=$3)`;
