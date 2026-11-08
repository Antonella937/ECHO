import { useParams } from 'wouter';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { CharacterPostGallery } from '@/components/characters/post-gallery';
import { useLanguage } from '@/lib/i18n';
import { galleryLabels } from '@/lib/gallery-translations';
export default function CharacterGalleryPage(){
 const {id}=useParams<{id:string}>();const {state,universeId}=useSocial();const back=useBack();
 const language=useLanguage();const character=state.characters.find(c=>c.id===id&&!c.archived);
 const labels=galleryLabels[language];
 return <main className="mx-auto max-w-2xl px-4 pb-28"><TopBar title={labels.title} onBack={back}/>{character?<><p className="mt-4 text-sm font-semibold">{character.name}</p><CharacterPostGallery characterId={character.id} universeId={universeId} accountType={character.accountType}/></>:<p className="mt-6 text-sm text-muted-foreground">{labels.missing}</p>}</main>;
}
