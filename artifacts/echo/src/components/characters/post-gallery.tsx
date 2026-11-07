import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useLanguage, type Language } from '@/lib/i18n';
import { compressImage, uploadPrivateImage, useMediaResolver } from '@/lib/media';
import { ImagePlus, Trash2 } from 'lucide-react';

type Photo = { id:string; mediaRef:string; reusable:boolean; reserved:boolean; usedCount:number; lastUsedAt:string|null };
const copy:Record<Language,[string,string,string,string,string,string,string,string,string,string]> = {
 es:['Galería de publicaciones','Fotos privadas disponibles para futuras publicaciones espontáneas. No son referencias de identidad visual.','Subir fotos','Se puede reutilizar','Reservar (no publicar)','Usada','Sin usar','Eliminar','No se pudo actualizar la galería.','Primero guardá el personaje para crear su galería.'],
 en:['Post gallery','Private photos available for future spontaneous posts. These are not visual identity references.','Upload photos','Can be reused','Keep private (do not post)','Used','Unused','Delete','Could not update the gallery.','Save the character first to create a gallery.'],
 pt:['Galeria de publicações','Fotos privadas para futuras publicações espontâneas. Não são referências visuais.','Enviar fotos','Pode reutilizar','Reservar (não publicar)','Usada','Não usada','Excluir','Não foi possível atualizar a galeria.','Salve o personagem primeiro.'],
 fr:['Galerie de publications','Photos privées pour de futures publications spontanées, distinctes des références visuelles.','Ajouter des photos','Réutilisable','Réserver (ne pas publier)','Utilisée','Non utilisée','Supprimer','Impossible de mettre à jour la galerie.','Enregistrez d’abord le personnage.'],
 de:['Beitragsgalerie','Private Fotos für spätere spontane Beiträge, getrennt von visuellen Referenzen.','Fotos hochladen','Wiederverwendbar','Zurückhalten (nicht posten)','Verwendet','Unbenutzt','Löschen','Galerie konnte nicht aktualisiert werden.','Speichere zuerst den Charakter.'],
 it:['Galleria dei post','Foto private per futuri post spontanei, separate dai riferimenti visivi.','Carica foto','Riutilizzabile','Riserva (non pubblicare)','Usata','Non usata','Elimina','Impossibile aggiornare la galleria.','Salva prima il personaggio.'],
 ko:['게시물 갤러리','나중에 자발적으로 게시할 수 있는 비공개 사진입니다. 외형 참고 이미지와는 별개입니다.','사진 업로드','재사용 가능','보관 (게시 안 함)','사용됨','미사용','삭제','갤러리를 업데이트할 수 없습니다.','먼저 캐릭터를 저장하세요.'],
 ja:['投稿ギャラリー','将来の自発的な投稿に使う非公開写真です。外見の参考画像とは別です。','写真を追加','再利用可能','保留（投稿しない）','使用済み','未使用','削除','ギャラリーを更新できませんでした。','先にキャラクターを保存してください。'],
 zh:['发帖图库','供角色日后自主发布的私人照片，与外观参考图分开。','上传照片','允许重复使用','保留（不发布）','已使用','未使用','删除','无法更新图库。','请先保存角色。']
};
export function CharacterPostGallery({characterId,universeId='primary'}:{characterId?:string;universeId?:string}) {
 const lang=useLanguage();const t=copy[lang];const resolve=useMediaResolver();
 const [photos,setPhotos]=useState<Photo[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const picker=useRef<HTMLInputElement>(null);
 const query=new URLSearchParams({universeId,characterId:characterId??''}).toString();
 const reload=async()=>{if(!characterId)return;const result=await customFetch<{photos:Photo[]}>('/api/character-gallery?'+query,{responseType:'json'});setPhotos(result.photos);};
 useEffect(()=>{let active=true;if(!characterId)return;void customFetch<{photos:Photo[]}>('/api/character-gallery?'+query,{responseType:'json'}).then(r=>{if(active)setPhotos(r.photos)}).catch(()=>{if(active)setError(t[8])});return()=>{active=false};},[characterId,universeId]);
 async function add(files:FileList|null){if(!files?.length||!characterId)return;setBusy(true);setError('');try{for(const file of Array.from(files)){if(!file.type.startsWith('image/'))continue;const mediaRef=await uploadPrivateImage(await compressImage(file,1440));await customFetch('/api/character-gallery',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId,universeId,mediaRef,reusable:false})});}await reload();}catch{setError(t[8]);}finally{setBusy(false);if(picker.current)picker.current.value='';}}
 async function patch(photo:Photo,change:Partial<Pick<Photo,'reusable'|'reserved'>>){setBusy(true);try{await customFetch('/api/character-gallery/'+encodeURIComponent(photo.id),{method:'PATCH',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify(change)});await reload();}catch{setError(t[8])}finally{setBusy(false)}}
 async function remove(photo:Photo){setBusy(true);try{await customFetch('/api/character-gallery/'+encodeURIComponent(photo.id),{method:'DELETE',responseType:'json'});await reload();}catch{setError(t[8])}finally{setBusy(false)}}
 return <section className="mt-6 rounded-2xl border border-border bg-card/40 p-4">
  <h3 className="font-display text-lg">{t[0]}</h3><p className="mt-1 mb-4 text-xs text-muted-foreground">{t[1]}</p>
  {characterId?<><input ref={picker} type="file" accept="image/*" multiple className="hidden" onChange={e=>void add(e.target.files)}/>
  <button type="button" disabled={busy} onClick={()=>picker.current?.click()} className="mb-4 flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground"><ImagePlus size={17}/>{t[2]}</button>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map(photo=><div key={photo.id} className="rounded-xl border border-border p-2">
    <img src={resolve(photo.mediaRef)} alt="" className="aspect-square w-full rounded-lg object-cover"/>
    <p className="my-2 text-xs text-muted-foreground">{photo.usedCount?t[5]+' · '+photo.usedCount:t[6]}</p>
    <label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={photo.reusable} disabled={busy} onChange={e=>void patch(photo,{reusable:e.target.checked})}/>{t[3]}</label>
    <label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={photo.reserved} disabled={busy} onChange={e=>void patch(photo,{reserved:e.target.checked})}/>{t[4]}</label>
    <button type="button" disabled={busy} onClick={()=>void remove(photo)} className="flex items-center gap-1 text-xs text-destructive"><Trash2 size={13}/>{t[7]}</button>
   </div>)}</div></>:<p className="text-xs text-muted-foreground">{t[9]}</p>}
  {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
 </section>;
}
