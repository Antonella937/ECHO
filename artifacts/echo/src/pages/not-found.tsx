import { Link } from 'wouter';
import { useLanguage } from '@/lib/i18n';
const copy = {"es":["{heading}","{description}","Volver al inicio"],"en":["Nothing echoes here","This page does not exist.","Back to home"],"pt":["Nada ecoa por aqui","Esta página não existe.","Voltar ao início"],"fr":["Aucun écho ici","Cette page n’existe pas.","Retour à l’accueil"],"de":["Hier hallt nichts wider","Diese Seite existiert nicht.","Zur Startseite"],"it":["Qui non risuona nulla","Questa pagina non esiste.","Torna alla home"],"ko":["여기에는 메아리가 없어요","이 페이지는 존재하지 않습니다.","홈으로 돌아가기"],"ja":["ここには何も響きません","このページは存在しません。","ホームに戻る"],"zh":["这里没有回响","此页面不存在。","返回首页"]} as Record<string, readonly [string,string,string]>;

export default function NotFound() {
  const language = useLanguage();
  const [heading, description, home] = copy[language] ?? copy.es;
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-8 text-center">
      <span className="wordmark text-[40px] text-foreground/20">ECHO</span>
      <p className="mt-6 font-display text-xl font-light">Aquí no resuena nada</p>
      <p className="mt-2 text-sm text-muted-foreground">Esta página no existe.</p>
      <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-full bg-secondary px-6 text-sm font-semibold" data-testid="link-404-home">
        {home}
      </Link>
    </div>
  );
}
