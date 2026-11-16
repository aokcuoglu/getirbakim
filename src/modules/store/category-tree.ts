export type StoreCategory={id:number;parentId:number|null;name:string;slug:string;path:number[];position:number;imagePath?:string|null};
export const legacyCategoryIds:Record<string,number>={'yedek-parca':3,fren:252,filtre:241,yag:956,silecek:607,aksesuar:967};
export function categorySlug(id:number,name:string){
 const legacy=Object.entries(legacyCategoryIds).find(([,value])=>value===id)?.[0];
 return legacy??name.toLocaleLowerCase('tr').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+id;
}
/**
 * A category name as it reads inside a sentence or title: lower case, except all-caps words of two or more letters
 * (ABS, LED, OEM), which stay as written. "ABS Sensörü" → "ABS sensörü".
 */
export function categoryNameInText(name:string){
 return name.split(" ").map(word=>{const letters=word.replace(/[^\p{L}]/gu,"");return letters.length>=2&&letters===letters.toLocaleUpperCase("tr")&&letters!==letters.toLocaleLowerCase("tr")?word:word.toLocaleLowerCase("tr");}).join(" ");
}
export function categoryPath(nodes:StoreCategory[],id:number){
 const node=nodes.find(n=>n.id===id);return node?node.path.map(i=>nodes.find(n=>n.id===i)).filter((n):n is StoreCategory=>Boolean(n)):[];
}

/** The six categories on the header bar and the home page tiles. */
export const featuredCategoryIds=[3,607,956,967,1023,11058];
/** What the server sends for a category it links to without the full tree. */
export type CategoryLink={id:number;name:string;slug:string;hasChildren:boolean};
const categoryLink=(nodes:StoreCategory[],node:StoreCategory):CategoryLink=>({id:node.id,name:node.name,slug:node.slug,hasChildren:nodes.some(n=>n.parentId===node.id)});
/** The header bar entries: the featured categories that exist, in their fixed order. */
export function headerCategoryLinks(nodes:StoreCategory[]):CategoryLink[]{
 return featuredCategoryIds.flatMap(id=>nodes.filter(n=>n.id===id).map(n=>categoryLink(nodes,n)));
}
export type SidebarCategoryBranch={parent:{name:string;slug:string}|null;nodes:CategoryLink[]};
/** The catalog sidebar's list: children of the selected category (the top level without one), its siblings for a leaf. */
export function sidebarCategoryBranch(nodes:StoreCategory[],selectedSlug?:string):SidebarCategoryBranch{
 const active=nodes.find(n=>n.slug===selectedSlug);
 const branch=active?nodes.filter(n=>n.parentId===active.id):[...nodes.filter(n=>n.parentId===3),...nodes.filter(n=>n.parentId===null&&n.id!==3)];
 const shown=branch.length?branch:nodes.filter(n=>n.parentId===active?.parentId);
 const parent=nodes.find(n=>n.id===active?.parentId);
 return {parent:parent?{name:parent.name,slug:parent.slug}:null,nodes:shown.map(n=>categoryLink(nodes,n))};
}
/** One row per category for /api/categories: [id, parentId, name, slug, mediaId]. Parents come before children only if the input has them so; unpacking does not rely on it. */
export type PackedCategory=[id:number,parentId:number|null,name:string,slug:string,mediaId:string|null];
const mediaPrefix="/api/category-media/";
export function packCategoryTree(nodes:StoreCategory[]):PackedCategory[]{
 return nodes.map(n=>[n.id,n.parentId,n.name,n.slug,n.imagePath?.startsWith(mediaPrefix)?n.imagePath.slice(mediaPrefix.length):null]);
}
/** The tree back from packed rows: order kept as position, path rebuilt from the parent chain (root first, the node last). */
export function unpackCategoryTree(rows:PackedCategory[]):StoreCategory[]{
 const parents=new Map(rows.map(([id,parentId])=>[id,parentId]));
 return rows.map(([id,parentId,name,slug,mediaId],position)=>{
  const path=[id];
  for(let parent:number|null|undefined=parentId;parent!=null&&!path.includes(parent);parent=parents.get(parent))path.unshift(parent);
  return {id,parentId,name,slug,path,position,imagePath:mediaId===null?null:mediaPrefix+mediaId};
 });
}
