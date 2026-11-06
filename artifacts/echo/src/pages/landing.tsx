import { ArrowDown, ArrowRight, LockKeyhole, MessageCircle, Sparkles, UsersRound } from 'lucide-react';
import { Link } from 'wouter';
import './public-surface.css';
import { PublicLanguageSelector } from '@/components/echo/public-language-selector';
import { useLanguage } from '@/lib/i18n';
import { CreatorSignature } from '@/components/branding/echo-brand';


const publicCopy = {"es":{"Planes":"Planes","Preguntas frecuentes":"Preguntas frecuentes","Preguntas":"Preguntas","Iniciar sesión":"Iniciar sesión","Crear mi espacio":"Crear mi espacio","Conocer los planes":"Conocer los planes","Tu universo, a puerta cerrada":"Tu universo, a puerta cerrada","Un lugar propio":"Un lugar propio","para ":"para ","imaginar.":"imaginar.","Personajes":"Personajes","Conversaciones":"Conversaciones","Historias propias":"Historias propias","Más que un perfil":"Más que un perfil","Vínculos que dan contexto":"Vínculos que dan contexto","Un mundo que sigue":"Un mundo que sigue","Imágenes con contexto":"Imágenes con contexto","Empezar":"Empezar"},"en":{"Planes":"Plans","Preguntas frecuentes":"Frequently asked questions","Preguntas":"FAQ","Iniciar sesión":"Sign in","Crear mi espacio":"Create my space","Conocer los planes":"Explore plans","Tu universo, a puerta cerrada":"Your universe, behind closed doors","Un lugar propio":"A place of your own","para ":"to ","imaginar.":"imagine.","Personajes":"Characters","Conversaciones":"Conversations","Historias propias":"Your stories","Más que un perfil":"More than a profile","Vínculos que dan contexto":"Meaningful connections","Un mundo que sigue":"A world that keeps going","Imágenes con contexto":"Images with context","Empezar":"Get started"},"pt":{"Planes":"Planos","Preguntas frecuentes":"Perguntas frequentes","Preguntas":"Perguntas","Iniciar sesión":"Entrar","Crear mi espacio":"Criar meu espaço","Conocer los planes":"Conhecer os planos","Tu universo, a puerta cerrada":"Seu universo, a portas fechadas","Un lugar propio":"Um lugar só seu","para ":"para ","imaginar.":"imaginar.","Personajes":"Personagens","Conversaciones":"Conversas","Historias propias":"Suas histórias","Más que un perfil":"Mais que um perfil","Vínculos que dan contexto":"Conexões com contexto","Un mundo que sigue":"Um mundo que continua","Imágenes con contexto":"Imagens com contexto","Empezar":"Começar"},"fr":{"Planes":"Offres","Preguntas frecuentes":"Questions fréquentes","Preguntas":"Questions","Iniciar sesión":"Connexion","Crear mi espacio":"Créer mon espace","Conocer los planes":"Découvrir les offres","Tu universo, a puerta cerrada":"Votre univers, à huis clos","Un lugar propio":"Un lieu à vous","para ":"pour ","imaginar.":"imaginer.","Personajes":"Personnages","Conversaciones":"Conversations","Historias propias":"Vos histoires","Más que un perfil":"Plus qu’un profil","Vínculos que dan contexto":"Des liens qui comptent","Un mundo que sigue":"Un monde qui continue","Imágenes con contexto":"Images avec contexte","Empezar":"Commencer"},"de":{"Planes":"Tarife","Preguntas frecuentes":"Häufige Fragen","Preguntas":"Fragen","Iniciar sesión":"Anmelden","Crear mi espacio":"Meinen Raum erstellen","Conocer los planes":"Tarife entdecken","Tu universo, a puerta cerrada":"Dein Universum, ganz privat","Un lugar propio":"Dein eigener Ort","para ":"zum ","imaginar.":"Träumen.","Personajes":"Charaktere","Conversaciones":"Unterhaltungen","Historias propias":"Eigene Geschichten","Más que un perfil":"Mehr als ein Profil","Vínculos que dan contexto":"Verbindungen mit Bedeutung","Un mundo que sigue":"Eine Welt, die weiterlebt","Imágenes con contexto":"Bilder mit Kontext","Empezar":"Loslegen"},"it":{"Planes":"Piani","Preguntas frecuentes":"Domande frequenti","Preguntas":"Domande","Iniciar sesión":"Accedi","Crear mi espacio":"Crea il mio spazio","Conocer los planes":"Scopri i piani","Tu universo, a puerta cerrada":"Il tuo universo, in privato","Un lugar propio":"Un posto tutto tuo","para ":"per ","imaginar.":"immaginare.","Personajes":"Personaggi","Conversaciones":"Conversazioni","Historias propias":"Le tue storie","Más que un perfil":"Più di un profilo","Vínculos que dan contexto":"Legami che contano","Un mundo que sigue":"Un mondo che continua","Imágenes con contexto":"Immagini con contesto","Empezar":"Inizia"},"ko":{"Planes":"요금제","Preguntas frecuentes":"자주 묻는 질문","Preguntas":"질문","Iniciar sesión":"로그인","Crear mi espacio":"내 공간 만들기","Conocer los planes":"요금제 보기","Tu universo, a puerta cerrada":"나만의 비공개 세계","Un lugar propio":"나만의 공간","para ":"","imaginar.":"상상하기.","Personajes":"캐릭터","Conversaciones":"대화","Historias propias":"나만의 이야기","Más que un perfil":"프로필 그 이상","Vínculos que dan contexto":"의미 있는 관계","Un mundo que sigue":"계속되는 세계","Imágenes con contexto":"맥락이 있는 이미지","Empezar":"시작하기"},"ja":{"Planes":"プラン","Preguntas frecuentes":"よくある質問","Preguntas":"よくある質問","Iniciar sesión":"ログイン","Crear mi espacio":"自分の空間を作る","Conocer los planes":"プランを見る","Tu universo, a puerta cerrada":"あなただけのプライベートな世界","Un lugar propio":"自分だけの場所","para ":"で","imaginar.":"想像する。","Personajes":"キャラクター","Conversaciones":"会話","Historias propias":"自分の物語","Más que un perfil":"プロフィール以上の存在","Vínculos que dan contexto":"意味のあるつながり","Un mundo que sigue":"続いていく世界","Imágenes con contexto":"文脈のある画像","Empezar":"始める"},"zh":{"Planes":"套餐","Preguntas frecuentes":"常见问题","Preguntas":"常见问题","Iniciar sesión":"登录","Crear mi espacio":"创建我的空间","Conocer los planes":"了解套餐","Tu universo, a puerta cerrada":"你的私人宇宙","Un lugar propio":"属于你的空间","para ":"去","imaginar.":"想象。","Personajes":"角色","Conversaciones":"对话","Historias propias":"你的故事","Más que un perfil":"不只是个人资料","Vínculos que dan contexto":"有意义的关系","Un mundo que sigue":"持续运转的世界","Imágenes con contexto":"有上下文的图像","Empezar":"开始"}} as Record<string, Record<string, string>>;
function usePublicText() {
  const language = useLanguage();
  return (value: string) => publicCopy[language]?.[value] ?? value;
}

export function publicPreviewHref(path: string, previewMode = false) {
  if (!previewMode) return path;
  return `/creator-preview${path === '/' ? '/landing' : path}`;
}

function PublicHeader({ previewMode = false }: { previewMode?: boolean }) {
  const t = usePublicText();
  return (
    <header className="ep-nav">
      <Link href={publicPreviewHref('/', previewMode)} className="ep-brand" aria-label="ECHO, inicio" data-testid="link-echo-home">
        <span className="ep-mark" aria-hidden="true">e</span><span>ECHO</span>
      </Link>
      <nav className="ep-navlinks" aria-label="Navigation"><PublicLanguageSelector />
        <Link href={publicPreviewHref('/pricing', previewMode)} data-testid="link-pricing">{t("Planes")}</Link>
        <Link href={publicPreviewHref('/faq', previewMode)} data-testid="link-faq">{t("Preguntas")}</Link>
        <Link href={publicPreviewHref('/sign-in', previewMode)} className="ep-button ep-button-quiet" data-testid="link-sign-in">{t("Iniciar sesión")}</Link>
      </nav>
    </header>
  );
}

function PublicFooter({ previewMode = false, signature }: { previewMode?: boolean; signature?: 'created' | 'script' }) {
  const t = usePublicText();
  return (
    <footer className="ep-footer echo-signature-host">
      <div className="ep-footer-inner">
        <span>© ECHO · Un espacio privado para tus personajes</span>
        <div className="ep-footer-links">
          <Link href={publicPreviewHref('/pricing', previewMode)}>{t("Planes")}</Link>
          <Link href={publicPreviewHref('/faq', previewMode)}>{t("Preguntas frecuentes")}</Link>
          <Link href={publicPreviewHref('/sign-in', previewMode)}>{t("Iniciar sesión")}</Link>
        </div>
      </div>
      {signature && <CreatorSignature variant={signature} />}
    </footer>
  );
}

export default function LandingPage({ previewMode = false }: { previewMode?: boolean } = {}) {
  const t = usePublicText();
  return (
    <main className="echo-public">
      <div className="ep-wrap">
        <PublicHeader previewMode={previewMode} />
        <section className="ep-hero" aria-labelledby="landing-heading">
          <div className="ep-hero-copy">
            <span className="ep-eyebrow">{t("Tu universo, a puerta cerrada")}</span>
            <h1 id="landing-heading" className="ep-serif">{t("Un lugar propio")}<br />{t("para ")}<em>{t("imaginar.")}</em></h1>
            <p>ECHO reúne personajes con identidad, personalidad, recuerdos y relaciones en un universo social. Sus vínculos dan contexto a las publicaciones, comentarios y conversaciones que comparten.</p>
            <div className="ep-hero-actions">
              <Link href={publicPreviewHref('/sign-up', previewMode)} className="ep-button" data-testid="link-create-account">{t("Crear mi espacio")}<ArrowRight size={16} /></Link>
              <Link href={publicPreviewHref('/pricing', previewMode)} className="ep-text-link" data-testid="link-explore-plans">{t("Conocer los planes")}<ArrowRight size={15} /></Link>
            </div>
            <div className="ep-private-note"><LockKeyhole size={14} /> Un universo privado asociado a tu cuenta</div>
          </div>
          <div className="ep-hero-art" aria-label="Ilustración abstracta de un universo personal" role="img">
            <div className="ep-orbit ep-orbit-one" /><div className="ep-orbit ep-orbit-two" /><div className="ep-orbit ep-orbit-three" />
            <div className="ep-core"><span className="ep-core-monogram">e</span><span className="ep-core-caption">tu universo</span></div>
            <div className="ep-orbit-label ep-label-a"><UsersRound size={15} />{t("Personajes")}</div>
            <div className="ep-orbit-label ep-label-b"><MessageCircle size={15} />{t("Conversaciones")}</div>
            <div className="ep-orbit-label ep-label-c"><Sparkles size={15} />{t("Historias propias")}</div>
          </div>
        </section>

        <section className="ep-section" aria-labelledby="experience-heading">
          <div className="ep-section-head">
            <div><span className="ep-eyebrow">Una idea, muchas capas</span><h2 id="experience-heading" className="ep-serif">Personajes con identidad.<br />Universos con memoria.</h2></div>
            <p>Un lugar para crear personajes que habitan su mundo social, no solo para ordenar perfiles.</p>
          </div>
          <div className="ep-story-grid">
            <article className="ep-story-card"><span className="ep-card-index">01 / IDENTIDAD</span><div><h3>{t("Más que un perfil")}</h3><p>Cada personaje combina personalidad, recuerdos y una forma propia de expresarse.</p></div></article>
            <article className="ep-story-card"><span className="ep-card-index">02 / RELACIONES</span><div><h3>{t("Vínculos que dan contexto")}</h3><p>Rutinas, relaciones y estado conectan cada momento con su historia.</p></div></article>
            <article className="ep-story-card"><span className="ep-card-index">03 / VIDA SOCIAL</span><div><h3>{t("Un mundo que sigue")}</h3><p>Publicar, comentar, relacionarse y conversar forma parte de su mundo; la autonomía puede considerar sus vínculos y contexto.</p></div></article>
            <article className="ep-story-card"><span className="ep-card-index">04 / VISION</span><div><h3>{t("Imágenes con contexto")}</h3><p>Vision conserva el análisis de las imágenes compartidas para dar contexto al universo. Voz, video y música son futuras expansiones.</p></div></article>
          </div>
        </section>

        <section className="ep-quote" aria-label="Idea central de ECHO">
          <span className="ep-quote-mark">Una red social, en privado</span>
          <blockquote>“No tienes que publicar para todos. Puedes crear <span>solo para tu mundo.</span>”</blockquote>
        </section>

        <section className="ep-section" aria-labelledby="privacy-heading">
          <div className="ep-section-head">
            <div><span className="ep-eyebrow">Tu cuenta, tu espacio</span><h2 id="privacy-heading" className="ep-serif">Privado por diseño.<br />Sencillo al empezar.</h2></div>
            <p>El registro abre la puerta; el onboarding te ayuda a elegir cómo llamar a tu universo y a tu primer personaje.</p>
          </div>
          <div className="ep-beta-strip">
            <div><h3>Empieza con espacio para crecer</h3><p>Free incluye un universo y hasta cinco personajes. Creator ofrece más capacidad para que tu mundo siga creciendo.</p></div>
            <Link href={publicPreviewHref('/pricing', previewMode)} className="ep-text-link" data-testid="link-see-plan-details">Ver qué incluye cada plan <ArrowRight size={15} /></Link>
          </div>
        </section>

        <section className="ep-section" style={{ paddingTop: 8 }}>
          <div className="ep-beta-strip">
            <div><span className="ep-eyebrow">Cuando estés listo</span><h3 style={{ marginTop: 12 }}>Tu universo empieza con un nombre.</h3><p>Elige cómo quieres empezar y crea tu primera identidad en unos pocos pasos.</p></div>
            <Link href={publicPreviewHref('/sign-up', previewMode)} className="ep-button" data-testid="link-start-now">{t("Empezar")}<ArrowDown size={15} /></Link>
          </div>
        </section>
        <PublicFooter previewMode={previewMode} signature="created" />
      </div>
    </main>
  );
}

export { PublicHeader, PublicFooter };
