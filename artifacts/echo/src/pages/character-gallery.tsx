import { useParams } from 'wouter';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { CharacterPostGallery } from '@/components/characters/post-gallery';
import { useLanguage } from '@/lib/i18n';
export default function CharacterGalleryPage(){
 const {id}=useParams<{id:string}>();const {state}=useSocial();const back=useBack();
 const language=useLanguage();const character=state.characters.find(c=>c.id===id&&!c.archived);
 const title=({es:'Galería del personaje',en:'Character gallery',pt:'Galeria do personagem',fr:'Galerie du personnage',de:'Charaktergalerie',it:'Galleria del personaggio',ko:'캐릭터 갤러리',ja:'キャラクターギャラリー',zh:'角色图库'} as Record<string,string>)[language]??'Character gallery';
 return <main className="mx-auto max-w-2xl px-4 pb-28"><TopBar title={title} onBack={back}/>{character?<><p className="mt-4 text-sm font-semibold">{character.name}</p><CharacterPostGallery characterId={character.id}/></>:<p className="mt-6 text-sm text-muted-foreground">Character not found.</p>}</main>;
}
