import { useLanguage } from './i18n';

const strings = {
  es: { title:'Anuncios oficiales', detail:'Novedades de la fundadora de ECHO, sin necesidad de seguirla.', subscribed:'Suscripto', muted:'Silenciado', update:'Actualización oficial de ECHO', read:'Ver actualización', close:'Cerrar', open:'Abrir Creator Hub', following:'De creadores que seguís' },
  en: { title:'Official announcements', detail:'Updates from ECHO’s founder without following her.', subscribed:'Subscribed', muted:'Muted', update:'Official ECHO update', read:'Read update', close:'Close', open:'Open Creator Hub', following:'From creators you follow' },
  pt: { title:'Anúncios oficiais', detail:'Novidades da fundadora do ECHO sem precisar segui-la.', subscribed:'Inscrito', muted:'Silenciado', update:'Atualização oficial do ECHO', read:'Ver atualização', close:'Fechar', open:'Abrir Creator Hub', following:'Dos criadores que você segue' },
  fr: { title:'Annonces officielles', detail:'Actualités de la fondatrice d’ECHO sans devoir la suivre.', subscribed:'Abonné', muted:'En sourdine', update:'Actualité officielle ECHO', read:'Voir l’actualité', close:'Fermer', open:'Ouvrir Creator Hub', following:'Des créateurs que vous suivez' },
  de: { title:'Offizielle Ankündigungen', detail:'Neuigkeiten von ECHOs Gründerin, ohne ihr folgen zu müssen.', subscribed:'Abonniert', muted:'Stummgeschaltet', update:'Offizielles ECHO-Update', read:'Update ansehen', close:'Schließen', open:'Creator Hub öffnen', following:'Von Creatorn, denen du folgst' },
  it: { title:'Annunci ufficiali', detail:'Novità dalla fondatrice di ECHO senza doverla seguire.', subscribed:'Iscritto', muted:'Disattivato', update:'Aggiornamento ufficiale ECHO', read:'Leggi aggiornamento', close:'Chiudi', open:'Apri Creator Hub', following:'Dai creator che segui' },
  ko: { title:'공식 공지', detail:'팔로우하지 않아도 ECHO 창립자의 소식을 받을 수 있습니다.', subscribed:'구독 중', muted:'알림 끔', update:'ECHO 공식 업데이트', read:'업데이트 보기', close:'닫기', open:'크리에이터 허브 열기', following:'팔로우한 크리에이터의 소식' },
  ja: { title:'公式のお知らせ', detail:'フォローせずにECHO創設者からのお知らせを受け取れます。', subscribed:'購読中', muted:'通知オフ', update:'ECHO公式アップデート', read:'更新を見る', close:'閉じる', open:'Creator Hubを開く', following:'フォロー中のクリエイターから' },
  zh: { title:'官方公告', detail:'无需关注 ECHO 创始人，也能接收官方动态。', subscribed:'已订阅', muted:'已静音', update:'ECHO 官方更新', read:'查看更新', close:'关闭', open:'打开 Creator Hub', following:'来自你关注的创作者' },
} as const;
export function useOfficialAnnouncementText() {
  const language = useLanguage();
  return strings[language];
}
