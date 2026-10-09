export type StoreCategory={id:number;parentId:number|null;name:string;slug:string;path:number[];position:number;imagePath?:string|null};
export const legacyCategoryIds:Record<string,number>={'yedek-parca':3,fren:252,filtre:241,yag:956,silecek:607,aksesuar:967};
export function categorySlug(id:number,name:string){
 const legacy=Object.entries(legacyCategoryIds).find(([,value])=>value===id)?.[0];
 return legacy??name.toLocaleLowerCase('tr').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+id;
}
export function categoryPath(nodes:StoreCategory[],id:number){
 const node=nodes.find(n=>n.id===id);return node?node.path.map(i=>nodes.find(n=>n.id===i)).filter((n):n is StoreCategory=>Boolean(n)):[];
}
