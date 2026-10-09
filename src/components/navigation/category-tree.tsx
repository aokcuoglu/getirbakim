"use client";
import Link from 'next/link';
import {useState} from 'react';
import {Search,ChevronRight} from 'lucide-react';
import {categoryPath,type StoreCategory} from '@/modules/store/category-tree';

export function CategoryTree({categories,selected,href,onNavigate}:{categories:StoreCategory[];selected?:string;href:(slug:string)=>string;onNavigate?:()=>void}){
 const [search,setSearch]=useState('');
 const active=categories.find(c=>c.slug===selected);
 const parent=active?categories.find(c=>c.id===active.parentId):undefined;
 const branchNodes=active?categories.filter(c=>c.parentId===active.id):[...categories.filter(c=>c.parentId===3),...categories.filter(c=>c.parentId===null&&c.id!==3)];
 const shown=branchNodes.length?branchNodes:categories.filter(c=>c.parentId===active?.parentId);
 function branch():React.ReactNode{return <ul className="category-browser-list">{active&&<li className="category-browser-back"><Link href={parent?href(parent.slug):"/katalog"}>‹ {parent?.name??"Tüm kategoriler"}</Link></li>}{shown.map(c=><li key={c.id}><Link href={href(c.slug)} onClick={onNavigate} aria-current={c.slug===selected?'page':undefined} className={c.slug===selected?'selected':''}><span>{c.name}</span>{categories.some(n=>n.parentId===c.id)&&<ChevronRight size={14}/>}</Link></li>)}</ul>;}
 const matches=categories.filter(c=>c.name.toLocaleLowerCase('tr').includes(search.trim().toLocaleLowerCase('tr')));
 return <div className="store-category-tree"><label className="store-category-search"><Search size={16}/><input type="search" aria-label="Kategori ara" placeholder="Kategori ara" value={search} onChange={e=>setSearch(e.target.value)}/></label>
 {search.trim()?<ul className="store-category-matches">{matches.map(c=><li key={c.id}><Link href={href(c.slug)} onClick={onNavigate} aria-current={c.slug===selected?'page':undefined}>{c.name}<small>{categoryPath(categories,c.id).slice(0,-1).map(n=>n.name).join(' / ')}</small></Link></li>)}{!matches.length&&<li className="muted">Kategori bulunamadı.</li>}</ul>:branch()}</div>;
}
