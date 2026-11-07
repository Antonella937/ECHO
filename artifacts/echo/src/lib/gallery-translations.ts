import type { Language } from '@/lib/i18n';
export const galleryLabels: Record<Language,{title:string;description:string;missing:string}> = {
 es:{title:'Galería del personaje',description:'Descripción de la foto',missing:'No se encontró el personaje.'},
 en:{title:'Character gallery',description:'Photo description',missing:'Character not found.'},
 pt:{title:'Galeria do personagem',description:'Descrição da foto',missing:'Personagem não encontrado.'},
 fr:{title:'Galerie du personnage',description:'Description de la photo',missing:'Personnage introuvable.'},
 de:{title:'Charaktergalerie',description:'Fotobeschreibung',missing:'Charakter nicht gefunden.'},
 it:{title:'Galleria del personaggio',description:'Descrizione della foto',missing:'Personaggio non trovato.'},
 ko:{title:'캐릭터 갤러리',description:'사진 설명',missing:'캐릭터를 찾을 수 없습니다.'},
 ja:{title:'キャラクターギャラリー',description:'写真の説明',missing:'キャラクターが見つかりません。'},
 zh:{title:'角色图库',description:'照片描述',missing:'未找到角色。'}
};
