import { Film, Music2, Clock3, ArrowLeft, Sparkles } from 'lucide-react';
import { useLocation } from 'wouter';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { useLanguage, type Language } from '@/lib/i18n';

type Addon = 'music' | 'video';
type Copy = {description:string; benefit:string; status:string; plans:string; back:string};
const copy: Record<Language, Copy> = {
  es:{description:'Creá música original y descubrí nuevas formas de compartirla en ECHO.',benefit:'Complemento opcional de ECHO. Los detalles y el precio se anunciarán antes de su lanzamiento.',status:'Próximamente disponible',plans:'Ver planes de ECHO',back:'Volver'},
  en:{description:'Create original music and discover new ways to share it on ECHO.',benefit:'Optional ECHO add-on. Details and pricing will be announced before launch.',status:'Coming soon',plans:'View ECHO plans',back:'Back'},
  pt:{description:'Crie músicas originais e descubra novas formas de compartilhá-las no ECHO.',benefit:'Complemento opcional do ECHO. Detalhes e preços serão anunciados antes do lançamento.',status:'Disponível em breve',plans:'Ver planos do ECHO',back:'Voltar'},
  fr:{description:'Créez de la musique originale et découvrez de nouvelles façons de la partager sur ECHO.',benefit:'Module optionnel ECHO. Les détails et les tarifs seront annoncés avant le lancement.',status:'Bientôt disponible',plans:'Voir les offres ECHO',back:'Retour'},
  de:{description:'Erstelle eigene Musik und entdecke neue Möglichkeiten, sie auf ECHO zu teilen.',benefit:'Optionales ECHO-Add-on. Details und Preise werden vor dem Start bekannt gegeben.',status:'Demnächst verfügbar',plans:'ECHO-Tarife ansehen',back:'Zurück'},
  it:{description:'Crea musica originale e scopri nuovi modi per condividerla su ECHO.',benefit:'Componente aggiuntivo opzionale di ECHO. Dettagli e prezzi saranno annunciati prima del lancio.',status:'Prossimamente disponibile',plans:'Vedi i piani ECHO',back:'Indietro'},
  ko:{description:'나만의 음악을 만들고 ECHO에서 공유하는 새로운 방법을 만나보세요.',benefit:'ECHO의 선택형 추가 기능입니다. 출시 전에 세부 정보와 가격을 안내합니다.',status:'곧 출시됩니다',plans:'ECHO 요금제 보기',back:'뒤로'},
  ja:{description:'オリジナルの音楽を作り、ECHOで共有する新しい方法を見つけましょう。',benefit:'ECHOのオプション機能です。詳細と料金は公開前にお知らせします。',status:'近日公開',plans:'ECHOのプランを見る',back:'戻る'},
  zh:{description:'创作原创音乐，探索在 ECHO 分享音乐的新方式。',benefit:'ECHO 可选附加功能。详情和价格将在上线前公布。',status:'即将推出',plans:'查看 ECHO 套餐',back:'返回'},
};
const video: Record<Language, string> = {
  es:'Creá videos y GIF para dar vida a tus historias y publicaciones.',
  en:'Create videos and GIFs to bring your stories and posts to life.',
  pt:'Crie vídeos e GIFs para dar vida às suas histórias e publicações.',
  fr:'Créez des vidéos et des GIF pour donner vie à vos stories et publications.',
  de:'Erstelle Videos und GIFs, um deine Stories und Beiträge lebendig zu machen.',
  it:'Crea video e GIF per dare vita alle tue storie e ai tuoi post.',
  ko:'동영상과 GIF로 스토리와 게시물에 생동감을 더하세요.',
  ja:'動画やGIFを作成して、ストーリーや投稿をもっと魅力的に。',
  zh:'创建视频和 GIF，让你的动态和帖子更加生动。',
};
export default function ComingSoonAddonPage({addon}:{addon:Addon}) {
  const language = useLanguage();
  const t = copy[language] ?? copy.en;
  const back = useBack();
  const [,navigate] = useLocation();
  const isMusic = addon === 'music';
  const Icon = isMusic ? Music2 : Film;
  const title = isMusic ? 'ECHO Music' : 'ECHO Video/GIF';
  return <div>
    <TopBar title={title} onBack={back}/>
    <main className="mx-auto flex max-w-lg flex-col gap-5 px-4 pb-20 pt-8">
      <section className="rounded-3xl border border-border bg-card/70 p-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-8 w-8"/></div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{isMusic ? t.description : video[language]}</p>
        <div className="mt-6 rounded-2xl border border-border bg-background/60 p-4">
          <div className="flex items-center justify-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary"/>{t.benefit}</div>
        </div>
        <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"><Clock3 className="h-4 w-4"/>{t.status}</p>
        <button type="button" onClick={()=>navigate('/subscriptions')} className="mt-6 w-full rounded-xl border border-border px-4 py-3 text-sm font-semibold hover:bg-secondary">{t.plans}</button>
      </section>
      <button type="button" onClick={back} className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4"/>{t.back}</button>
    </main>
  </div>;
}
