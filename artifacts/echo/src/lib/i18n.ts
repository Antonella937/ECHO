import { useSyncExternalStore } from 'react';

export const LANGUAGES = [
  {code:'es',name:'Español'}, {code:'en',name:'English'}, {code:'pt',name:'Português'},
  {code:'fr',name:'Français'}, {code:'de',name:'Deutsch'}, {code:'it',name:'Italiano'},
  {code:'ko',name:'한국어'}, {code:'ja',name:'日本語'}, {code:'zh',name:'中文'},
] as const;
export type Language = typeof LANGUAGES[number]['code'];
const translations = {
  es:{home:'Inicio',messages:'Mensajes',create:'Crear',notifications:'Avisos',saved:'Guardados',profile:'Perfil',settings:'Ajustes',language:'Idioma',languageDescription:'Elegí el idioma de la interfaz de ECHO.',explore:'Explorar',createPublication:'Crear publicación',updates:'Actualizaciones',characters:'Personajes',worlds:'Mundos',posts:'Publicaciones',all:'Todo'},
  en:{home:'Home',messages:'Messages',create:'Create',notifications:'Notifications',saved:'Saved',profile:'Profile',settings:'Settings',language:'Language',languageDescription:'Choose the language of the ECHO interface.',explore:'Explore',createPublication:'Create post',updates:'Updates',characters:'Characters',worlds:'Worlds',posts:'Posts',all:'All'},
  pt:{home:'Início',messages:'Mensagens',create:'Criar',notifications:'Notificações',saved:'Salvos',profile:'Perfil',settings:'Configurações',language:'Idioma',languageDescription:'Escolha o idioma da interface do ECHO.',explore:'Explorar',createPublication:'Criar publicação',updates:'Atualizações',characters:'Personagens',worlds:'Mundos',posts:'Publicações',all:'Tudo'},
  fr:{home:'Accueil',messages:'Messages',create:'Créer',notifications:'Notifications',saved:'Enregistrés',profile:'Profil',settings:'Paramètres',language:'Langue',languageDescription:'Choisissez la langue de l’interface ECHO.',explore:'Explorer',createPublication:'Créer une publication',updates:'Actualités',characters:'Personnages',worlds:'Mondes',posts:'Publications',all:'Tout'},
  de:{home:'Startseite',messages:'Nachrichten',create:'Erstellen',notifications:'Benachrichtigungen',saved:'Gespeichert',profile:'Profil',settings:'Einstellungen',language:'Sprache',languageDescription:'Wähle die Sprache der ECHO-Oberfläche.',explore:'Entdecken',createPublication:'Beitrag erstellen',updates:'Neuigkeiten',characters:'Charaktere',worlds:'Welten',posts:'Beiträge',all:'Alle'},
  it:{home:'Home',messages:'Messaggi',create:'Crea',notifications:'Notifiche',saved:'Salvati',profile:'Profilo',settings:'Impostazioni',language:'Lingua',languageDescription:'Scegli la lingua dell’interfaccia ECHO.',explore:'Esplora',createPublication:'Crea post',updates:'Aggiornamenti',characters:'Personaggi',worlds:'Mondi',posts:'Post',all:'Tutti'},
  ko:{home:'홈',messages:'메시지',create:'만들기',notifications:'알림',saved:'저장됨',profile:'프로필',settings:'설정',language:'언어',languageDescription:'ECHO 인터페이스 언어를 선택하세요.',explore:'탐색',createPublication:'게시물 만들기',updates:'업데이트',characters:'캐릭터',worlds:'세계',posts:'게시물',all:'전체'},
  ja:{home:'ホーム',messages:'メッセージ',create:'作成',notifications:'通知',saved:'保存済み',profile:'プロフィール',settings:'設定',language:'言語',languageDescription:'ECHOの表示言語を選択してください。',explore:'探索',createPublication:'投稿を作成',updates:'更新情報',characters:'キャラクター',worlds:'世界',posts:'投稿',all:'すべて'},
  zh:{home:'首页',messages:'消息',create:'创建',notifications:'通知',saved:'已保存',profile:'个人资料',settings:'设置',language:'语言',languageDescription:'选择 ECHO 界面的语言。',explore:'探索',createPublication:'创建帖子',updates:'更新',characters:'角色',worlds:'世界',posts:'帖子',all:'全部'},
} satisfies Record<Language,Record<string,string>>;
export type TranslationKey = keyof typeof translations.es;
const key='echo.interface.language';
function initial():Language {
  try { const saved=localStorage.getItem(key);if(LANGUAGES.some(x=>x.code===saved))return saved as Language; }catch{}
  const browser=typeof navigator==='undefined'?'es':navigator.language.slice(0,2).toLowerCase();
  return LANGUAGES.some(x=>x.code===browser)?browser as Language:'es';
}
let language:Language=initial();
const listeners=new Set<()=>void>();
export function setLanguage(next:Language){language=next;try{localStorage.setItem(key,next)}catch{};if(typeof document!=='undefined')document.documentElement.lang=next;listeners.forEach(fn=>fn());}
export function getLanguage(){return language;}
export function useLanguage(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>listeners.delete(cb);},getLanguage,getLanguage);}
export function useTranslation(){const lang=useLanguage();return (key:TranslationKey)=>translations[lang][key]||translations.es[key];}
