import {categoryRef,type CategoryNode,type SourceCategory} from './source-categories';
import {singular,typeSlug,type TypeDictionary} from './type-categories';

// Candidate categories for an unmapped part type (#860, report-unmapped): token overlap with the accepted learned types
// and Trodo's leaf category names. Only an aid for curating src/modules/enrichment/type-aliases.ts by hand.

export type TypeSuggestion={kind:'type'|'category';type?:string;categories:SourceCategory[];score:number};
const stopWords=new Set(['and','for','of','the','system','kit','set']);
/** Words of a type slug or category name; the last one plural-folded, stop words dropped. */
function tokens(value:string){
 const words=typeSlug(value).split('-').filter(Boolean);
 if(words.length)words[words.length-1]=singular(words[words.length-1]);
 return new Set(words.filter(w=>!stopWords.has(w)));
}
const jaccard=(a:Set<string>,b:Set<string>)=>{let shared=0;for(const w of a)if(b.has(w))shared++;const union=a.size+b.size-shared;return union?shared/union:0;};

/** A suggester over one dictionary and category tree (the candidates are tokenized once). */
export function typeSuggester(dict:TypeDictionary,nodes:Map<number,CategoryNode>,{limit=3}:{limit?:number}={}){
 const parents=new Set<number>();
 for(const node of nodes.values())if(node.path_ids.length>1)parents.add(node.path_ids[node.path_ids.length-2]);
 const candidates=[
  ...[...dict.exact].map(([type,categories])=>({kind:'type' as const,type,categories,words:tokens(type),key:type})),
  ...[...nodes.values()].filter(n=>!parents.has(n.category_id)).map(n=>({kind:'category' as const,type:undefined,categories:[categoryRef(nodes,n.category_id)],words:tokens(n.name),key:n.name})),
 ];
 return (type:string):TypeSuggestion[]=>{
  const words=tokens(type);
  return candidates.map(c=>({c,score:jaccard(words,c.words)})).filter(s=>s.score>0)
   .sort((a,b)=>b.score-a.score||Number(a.c.kind==='category')-Number(b.c.kind==='category')||a.c.key.localeCompare(b.c.key)).slice(0,limit)
   .map(({c,score})=>({kind:c.kind,...(c.type?{type:c.type}:{}),categories:c.categories,score:Math.round(score*100)/100}));
 };
}
/** Up to limit candidates for one type, best first (a learned type before a category at the same score); none without a
 *  shared word. */
export function suggestTypeCategories(type:string,dict:TypeDictionary,nodes:Map<number,CategoryNode>,options:{limit?:number}={}){
 return typeSuggester(dict,nodes,options)(type);
}
