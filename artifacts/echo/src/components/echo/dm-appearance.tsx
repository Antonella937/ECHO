import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';

const words: Record<string,[string,string,string,string,string,string]> = {
 es:['Apariencia del chat','Fondo','Transparencia','Sin fondo','Oscuro','Guardar'],
 en:['Chat appearance','Background','Transparency','No background','Dark','Save'],
 pt:['Aparência do chat','Fundo','Transparência','Sem fundo','Escuro','Salvar'],
 fr:['Apparence du chat','Fond','Transparence','Sans fond','Sombre','Enregistrer'],
 de:['Chat-Darstellung','Hintergrund','Transparenz','Kein Hintergrund','Dunkel','Speichern'],
 it:['Aspetto chat','Sfondo','Trasparenza','Nessuno sfondo','Scuro','Salva'],
 ko:['채팅 모양','배경','투명도','배경 없음','어두움','저장'],
 ja:['チャットの外観','背景','透明度','背景なし','ダーク','保存'],
 zh:['聊天外观','背景','透明度','无背景','深色','保存'],
};
export type DmAppearance={background:string;opacity:number;image?:string;layout?:'chat'|'narrative'};
const choices=['none','dark','rose','violet','blue'] as const;
const gradients:Record<string,string>={
 dark:'linear-gradient(145deg,#14101f,#33283c)',rose:'linear-gradient(145deg,#4b283c,#ac668d)',
 violet:'linear-gradient(145deg,#282044,#755d9c)',blue:'linear-gradient(145deg,#192b3d,#48778d)',
};
export function readDmAppearance(key:string):DmAppearance{
 try{
  const raw=JSON.parse(localStorage.getItem(key)??'null') as Partial<DmAppearance>|null;
  return {background:(choices.includes(raw?.background as typeof choices[number])||(raw?.background==='photo'&&typeof raw.image==='string'&&raw.image.startsWith('data:image/')))?raw!.background!:'none',
   opacity:typeof raw?.opacity==='number'&&Number.isFinite(raw.opacity)?Math.max(0,Math.min(100,raw.opacity)):35, image:typeof raw?.image==='string'&&raw.image.startsWith('data:image/')?raw.image:undefined,layout:raw?.layout==='narrative'?'narrative':'chat'};
 }catch{return {background:'none',opacity:35};}
}
export function DmAppearanceSettings({storageKey,value,onChange}:{storageKey:string;value:DmAppearance;onChange:(next:DmAppearance)=>void}){
 const lang=useLanguage();const t=words[lang]??words.en;
 const [open,setOpen]=useState(false);
 const [uploadError,setUploadError]=useState(false);
 const [draft,setDraft]=useState(value);
 useEffect(()=>setDraft(value),[value]);
 return <div className="relative">
  <button type="button" onClick={()=>setOpen(v=>!v)} className="rounded-full border border-border px-3 py-2 text-xs" aria-expanded={open}>{t[0]}</button>
  {open&&<section className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-background p-3 shadow-xl">
   <p className="mb-2 text-xs font-medium">{t[1]}</p>
   <div className="flex flex-wrap gap-2">{choices.map(choice=><button type="button" key={choice}
    aria-label={choice==='none'?t[3]:choice==='dark'?t[4]:choice}
    aria-pressed={draft.background===choice}
    onClick={()=>setDraft(old=>({...old,background:choice}))}
    style={{background:gradients[choice]??'var(--background)'}}
    className={`h-9 w-9 rounded-full border-2 ${draft.background===choice?'border-primary':'border-border'}`}/>)}</div>
   <label className="mt-3 block text-xs">{lang==='es'?'Importar foto':lang==='pt'?'Importar foto':lang==='fr'?'Importer une photo':lang==='de'?'Foto importieren':lang==='it'?'Importa foto':lang==='ko'?'사진 가져오기':lang==='ja'?'写真を読み込む':lang==='zh'?'导入照片':'Import photo'}
    <input className="mt-1 block w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{
     const file=e.target.files?.[0];if(!file)return;
     if(file.size>2_000_000){setUploadError(true);return;}
     const reader=new FileReader();reader.onload=()=>{if(typeof reader.result==='string'){setDraft(old=>({...old,background:'photo',image:reader.result as string}));setUploadError(false);}};
     reader.onerror=()=>setUploadError(true);reader.readAsDataURL(file);
    }}/>
   </label>
   {uploadError&&<p role="alert" className="text-xs text-destructive">{lang==='es'?'Imagen demasiado grande o no se pudo guardar (máximo 2 MB).':'Image too large or could not be saved (max 2 MB).'}</p>}
   {draft.image&&<button type="button" onClick={()=>setDraft(old=>({...old,image:undefined,background:'none'}))} className="mt-2 block text-xs underline">{lang==='es'?'Quitar foto':'Remove photo'}</button>}
   <fieldset className="mt-3"><legend className="text-xs">{lang==='es'?'Presentación':lang==='pt'?'Apresentação':lang==='fr'?'Affichage':lang==='de'?'Darstellung':lang==='it'?'Visualizzazione':lang==='ko'?'표시 방식':lang==='ja'?'表示形式':lang==='zh'?'显示方式':'Display mode'}</legend>
    <div className="mt-1 flex gap-2">{(['chat','narrative'] as const).map(layout=><button key={layout} type="button" aria-pressed={(draft.layout??'chat')===layout} onClick={()=>setDraft(old=>({...old,layout}))} className={`rounded-lg border px-3 py-2 text-xs ${(draft.layout??'chat')===layout?'border-primary bg-primary/15':'border-border'}`}>{layout==='chat'?(lang==='es'?'Chat':lang==='ko'?'채팅':lang==='ja'?'チャット':lang==='zh'?'聊天':'Chat'):(lang==='es'?'Narrativa':lang==='pt'?'Narrativa':lang==='fr'?'Narratif':lang==='de'?'Erzählung':lang==='it'?'Narrativa':lang==='ko'?'서술형':lang==='ja'?'物語形式':lang==='zh'?'叙事':'Narrative')}</button>)}</div>
   </fieldset>
   <label className="mt-3 block text-xs">{t[2]}: {draft.opacity}%
    <input type="range" min={0} max={100} value={draft.opacity} onChange={e=>setDraft(old=>({...old,opacity:Number(e.target.value)}))} className="mt-2 w-full"/>
   </label>
   <button type="button" className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground" onClick={()=>{
    try{localStorage.setItem(storageKey,JSON.stringify(draft));onChange(draft);setOpen(false);setUploadError(false);}catch{setUploadError(true);}
   }}>{t[5]}</button>
  </section>}
 </div>;
}
export function dmBackgroundStyle(value:DmAppearance){
 if(value.background==='photo' && value.image?.startsWith('data:image/')) return {backgroundImage:`linear-gradient(rgba(0,0,0,${(100-value.opacity)/130}),rgba(0,0,0,${(100-value.opacity)/130})),url(${JSON.stringify(value.image)})`,backgroundPosition:'center',backgroundSize:'cover',backgroundRepeat:'no-repeat'};
 if(value.background==='none') return {};
 const colors:Record<string,[string,string]>={
  dark:['#14101f','#33283c'],rose:['#4b283c','#ac668d'],
  violet:['#282044','#755d9c'],blue:['#192b3d','#48778d'],
 };
 const [a,b]=colors[value.background]??colors.dark;
 const opacity=Math.max(0,Math.min(100,value.opacity));
 return {backgroundImage:`linear-gradient(145deg,color-mix(in srgb,${a} ${opacity}%,transparent),color-mix(in srgb,${b} ${opacity}%,transparent))`};
}
