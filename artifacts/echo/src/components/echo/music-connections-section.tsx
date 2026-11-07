import { useLanguage } from '@/lib/i18n';
import { Music2, ExternalLink } from 'lucide-react';

const musicConnectionText = {"es":["Conexiones musicales","Vinculá servicios de música para compartir enlaces y contenido autorizado. Conectar una cuenta no habilita la reproducción de fragmentos protegidos en ECHO.","Conexión próximamente","Nunca ingreses tu contraseña de Spotify o Google en ECHO. La conexión futura usará la autorización oficial de cada servicio."],"en":["Music connections","Link music services to share links and authorized content. Connecting an account does not enable playback of copyrighted clips in ECHO.","Connection coming soon","Never enter your Spotify or Google password in ECHO. Future connections will use each service's official authorization."],"pt":["Conexões musicais","Vincule serviços de música para compartilhar links e conteúdo autorizado. Conectar uma conta não permite reproduzir trechos protegidos no ECHO.","Conexão em breve","Nunca insira sua senha do Spotify ou Google no ECHO. As conexões futuras usarão a autorização oficial de cada serviço."],"fr":["Connexions musicales","Associez des services musicaux pour partager des liens et du contenu autorisé. Connecter un compte ne permet pas de lire des extraits protégés dans ECHO.","Connexion prochainement","Ne saisissez jamais votre mot de passe Spotify ou Google dans ECHO. Les futures connexions utiliseront l'autorisation officielle de chaque service."],"de":["Musikverbindungen","Verbinde Musikdienste, um Links und autorisierte Inhalte zu teilen. Das Verbinden eines Kontos erlaubt keine Wiedergabe geschützter Ausschnitte in ECHO.","Verbindung demnächst","Gib dein Spotify- oder Google-Passwort niemals in ECHO ein. Künftige Verbindungen verwenden die offizielle Autorisierung des jeweiligen Dienstes."],"it":["Collegamenti musicali","Collega servizi musicali per condividere link e contenuti autorizzati. Collegare un account non consente di riprodurre clip protette in ECHO.","Connessione in arrivo","Non inserire mai la password di Spotify o Google in ECHO. Le future connessioni useranno l'autorizzazione ufficiale di ciascun servizio."],"ko":["음악 서비스 연결","음악 서비스를 연결해 링크와 허가된 콘텐츠를 공유하세요. 계정을 연결해도 ECHO에서 저작권 보호 음원 클립을 재생할 수 있는 것은 아닙니다.","연결 기능 준비 중","ECHO에 Spotify 또는 Google 비밀번호를 입력하지 마세요. 향후 연결은 각 서비스의 공식 인증을 사용합니다."],"ja":["音楽サービス連携","音楽サービスを連携して、リンクや許可されたコンテンツを共有できます。アカウントを連携しても、ECHOで保護された音源を再生する権利は得られません。","連携機能は近日公開","ECHOにSpotifyやGoogleのパスワードを入力しないでください。今後の連携には各サービスの公式認証を使用します。"],"zh":["音乐服务连接","连接音乐服务以分享链接和获授权的内容。连接账户并不意味着可以在 ECHO 中播放受版权保护的音频片段。","连接功能即将推出","请勿在 ECHO 中输入 Spotify 或 Google 密码。未来的连接将使用各服务的官方授权。"]} as Record<string,readonly string[]>;

/** Provider authorization must be implemented server-side before connecting accounts. */
export function MusicConnectionsSection() {
  const language = useLanguage();
  const labels = musicConnectionText[language] ?? musicConnectionText.en;
  return (
    <section className="mt-9" aria-labelledby="music-connections-h">
      <h2 id="music-connections-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{labels[0]}</h2>
      <p className="mt-2 px-1 text-xs text-muted-foreground">{labels[1]}</p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/60">
        {(['Spotify', 'YouTube'] as const).map(provider => (
          <div key={provider} className="flex min-h-16 items-center justify-between gap-3 border-b border-border/60 px-4 last:border-b-0">
            <span className="flex items-center gap-2 text-sm font-semibold"><Music2 className="h-4 w-4 text-primary" />{provider}</span>
            <span className="rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground">{labels[2]}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-xs text-muted-foreground">{labels[3]}</p>
    </section>
  );
}
