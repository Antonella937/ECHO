import { useWelcomeText } from '@/lib/welcome-translations';
import { useOfficialAnnouncementText } from '@/lib/official-announcement-translations';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { esES, enUS, ptBR, frFR, deDE, itIT, koKR, jaJP, zhCN } from '@clerk/localizations';
import { useLanguage, getLanguage, setLanguage, type Language } from '@/lib/i18n';
import { PublicLanguageSelector } from '@/components/echo/public-language-selector';
import { shadcn } from '@clerk/themes';
import {
  getGetUniverseQueryKey,
  useGetUniverse,
  useSaveUniverse,
  type UniverseEnvelope,
  setBaseUrl,
  setAuthTokenGetter,
  customFetch,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SocialStoreProvider } from '@/store/social-store';
import { StoryViewerProvider } from '@/components/echo/story-viewer';
import { Shell } from '@/components/echo/shell';
import { MessageSoundObserver } from '@/components/echo/message-sound-observer';
import { FounderSurprise } from '@/components/echo/founder-surprise';
import { AppearanceSync } from '@/components/echo/appearance-sync';
import HashtagPage from '@/pages/hashtag';
import SearchPage from '@/pages/search';
import { AppSkeleton } from '@/components/echo/skeletons';
import { EchoSplash } from '@/components/branding/echo-brand';
import HomePage from '@/pages/home';
import ProfilePage from '@/pages/profile';
import PostPage from '@/pages/post';
import CreatePage from '@/pages/create';
import NotificationsPage from '@/pages/notifications';
import MessagesPage from '@/pages/messages';
import ConversationPage from '@/pages/conversation';
import SavedPage from '@/pages/saved';
import SettingsPage from '@/pages/settings';
import EchoMusicPage from '@/pages/echo-music';
import SharedPreviewPage from '@/pages/shared-preview';
import CollaborationPage from '@/pages/collaboration';
import SubscriptionsPage from '@/pages/subscriptions';
import HelpCenterPage from '@/pages/help-center';
import SupportAdminPage from '@/pages/support-admin';
import NotFound from '@/pages/not-found';
import CharacterEditorPage from '@/pages/character-editor';
import LandingPage from '@/pages/landing';
import PricingPage from '@/pages/pricing';
import FaqPage from '@/pages/faq';
import { AuthScreenPreview, PublicReviewHub } from '@/pages/public-review';
import {
  CreatorAccountPreview,
  CreatorLimitPreview,
  CreatorPrivacyPreview,
  CreatorStorePreview,
  CreatorUniversePreview,
} from '@/pages/creator-product-previews';
import OnboardingPage, { type CreatorOnboardingInput } from '@/pages/onboarding';
import { AlphaConsentBoundary } from '@/components/echo/alpha-consent';
import BetaInformationPage from '@/pages/beta-information';
import CreatorPrivacyCenter from '@/pages/creator-privacy-center';
import CreatorHubPage from '@/pages/creator-hub';
import { createStarterUniverse } from '@/store/create-starter-universe';
import { shouldShowCreatorOnboarding } from '@/store/onboarding-routing';
import { loadLegacyState, loadRecovery } from '@/store/persistence';
import { getActiveUniverseId, setActiveUniverseId } from '@/store/persistence';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(344 42% 76%)',
    colorForeground: 'hsl(30 12% 93%)',
    colorMutedForeground: 'hsl(240 4% 64%)',
    colorDanger: 'hsl(356 58% 62%)',
    colorBackground: 'hsl(240 4% 8%)',
    colorInput: 'hsl(240 4% 11%)',
    colorInputForeground: 'hsl(30 12% 93%)',
    colorNeutral: 'hsl(240 4% 23%)',
    fontFamily: 'Manrope, sans-serif',
    borderRadius: '1rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#171619] rounded-2xl w-[calc(100vw-2rem)] max-w-[440px] overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#f2ece8] font-semibold',
    headerSubtitle: 'text-[#aaa5a6]',
    socialButtonsBlockButtonText: 'text-[#f2ece8]',
    formFieldLabel: 'text-[#ddd6d3]',
    footerActionLink: 'text-[#e0a6b6]',
    footerActionText: 'text-[#aaa5a6]',
    dividerText: 'text-[#aaa5a6]',
    identityPreviewEditButton: 'text-[#e0a6b6]',
    formFieldSuccessText: 'text-[#b7d9bd]',
    alertText: 'text-[#f2ece8]',
    logoBox: 'rounded-xl',
    logoImage: 'h-8 w-8',
    socialButtonsBlockButton: 'border-[#39373b] bg-[#201f22] hover:bg-[#29272b]',
    formButtonPrimary: 'bg-[#df9fb1] text-[#171619] hover:bg-[#eab4c2]',
    formFieldInput: 'border-[#39373b] bg-[#201f22] text-[#f2ece8]',
    footerAction: 'text-[#aaa5a6]',
    dividerLine: 'bg-[#39373b]',
    alert: 'border-[#67414b] bg-[#321f25]',
    otpCodeFieldInput: 'border-[#39373b] bg-[#201f22] text-[#f2ece8]',
    formFieldRow: 'text-[#ddd6d3]',
    main: 'text-[#f2ece8]',
  },
};

type OfficialUpdate = { id: string; title: string; body: string; createdAt: string };
function OfficialUpdateObserver() {
  const { user } = useUser();
  const language = useLanguage();
  const officialText = useOfficialAnnouncementText();
  const [, navigate] = useLocation();
  const [updates, setUpdates] = useState<OfficialUpdate[]>([]);
  const [visible, setVisible] = useState<OfficialUpdate | null>(null);
  const [expanded, setExpanded] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    initialized.current = false;
    const key = 'echo-official-update-seen:' + user.id;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await customFetch<{ updates: OfficialUpdate[] }>('/api/creator-hub/social/official-updates', { responseType: 'json' });
        if (!active) return;
        setUpdates(result.updates);
        const ids = result.updates.map(item => item.id);
        const stored = localStorage.getItem(key);
        if (!initialized.current && stored === null) {
          localStorage.setItem(key, JSON.stringify(ids));
          initialized.current = true;
          return;
        }
        initialized.current = true;
        let seen: string[] = [];
        try { seen = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* reset corrupted cache */ }
        const fresh = result.updates.find(item => !seen.includes(item.id));
        if (fresh) setVisible(previous => previous ?? fresh);
        localStorage.setItem(key, JSON.stringify([...new Set([...seen, ...ids])].slice(-300)));
      } catch { /* keep existing experience when announcements API is unavailable */ }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [user?.id]);
  const english = language === 'en';
  return <>
    {updates.length > 0 && <button type="button" onClick={() => setExpanded(true)} className="fixed bottom-4 left-4 z-[70] rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground shadow-xl" aria-label={officialText.title}>📣 ECHO {updates.length}</button>}
    {visible && <div role="status" className="fixed bottom-16 right-3 z-[80] w-[min(360px,calc(100vw-24px))] rounded-2xl border border-border bg-card p-4 text-foreground shadow-2xl">
      <div className="flex items-start justify-between gap-2"><strong className="text-sm">📣 {officialText.update}</strong><button type="button" aria-label={officialText.close} onClick={() => setVisible(null)}>×</button></div>
      <p className="mt-2 text-sm font-semibold">{visible.title}</p>
      <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{visible.body}</p>
      <button type="button" onClick={() => { setVisible(null); setExpanded(true); }} className="mt-3 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">{officialText.read}</button>
    </div>}
    {expanded && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setExpanded(false); }}>
      <section role="dialog" aria-modal="true" aria-label={officialText.title} className="max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">📣 {officialText.title}</h2><button type="button" onClick={() => setExpanded(false)} aria-label={officialText.close}>×</button></div>
        {updates.map(item => <article key={item.id} className="border-t border-border py-4"><h3 className="font-semibold">{item.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString(language)}</p></article>)}
        <button type="button" onClick={() => { setExpanded(false); navigate('/creator-hub'); }} className="mt-3 text-sm text-primary">{officialText.open}</button>
      </section>
    </div>}
  </>;
}

function FirstWelcomeDialog() {
  const { user } = useUser();
  const copy = useWelcomeText();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    let requested = false;
    const localKey = 'echo-welcome-claimed:' + user.id;
    const claim = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string }>).detail;
      if (detail?.userId !== user.id || requested) return;
      // Give the founder one local design review even if an earlier deployment
      // already marked the account welcome as delivered.
      const founderPreviewKey = 'echo-founder-welcome-review-v1:' + user.id;
      if (user.id === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' && !localStorage.getItem(founderPreviewKey)) {
        localStorage.setItem(founderPreviewKey, '1');
        setOpen(true);
        return;
      }
      if (localStorage.getItem(localKey)) return;
      requested = true;
      void customFetch<{ show: boolean }>('/api/creator-hub/social/claim-welcome', {
        method: 'POST', responseType: 'json',
      }).then(result => {
        if (!active) return;
        localStorage.setItem(localKey, '1');
        if (result.show) setOpen(true);
      }).catch(() => { requested = false; });
    };
    // The welcome waits until the signed-in account's language has loaded.
    window.addEventListener('echo:account-language-ready', claim);
    const openPreview = () => { if (user.id === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ') setOpen(true); };
    window.addEventListener('echo:preview-welcome', openPreview);
    // Language sync can finish before this component mounts.
    if (sessionStorage.getItem('echo:language-ready-user') === user.id) {
      claim(new CustomEvent('echo:account-language-ready', { detail: { userId: user.id } }));
    }
    const readyCheck = window.setInterval(() => {
      if (sessionStorage.getItem('echo:language-ready-user') === user.id) {
        window.clearInterval(readyCheck);
        claim(new CustomEvent('echo:account-language-ready', { detail: { userId: user.id } }));
      }
    }, 400);
    return () => { active = false; window.clearInterval(readyCheck); window.removeEventListener('echo:account-language-ready', claim); window.removeEventListener('echo:preview-welcome', openPreview); };
  }, [user?.id]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-5" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="echo-welcome-heading" className="w-full max-w-md rounded-3xl border border-primary/30 bg-card p-7 text-center text-foreground shadow-2xl">
      <div className="mb-4 text-4xl">🖤</div>
      <h2 id="echo-welcome-heading" className="text-2xl font-bold">{copy.heading}</h2>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">{copy.message}</p>
      <p className="mt-5 text-sm font-semibold text-primary">{copy.signature}</p>
      <button type="button" autoFocus onClick={() => setOpen(false)} className="mt-7 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground">{copy.button}</button>
    </section>
  </div>;
}

function ProtectedRouter() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return (
    <Shell>
      <MessageSoundObserver />
      <OfficialUpdateObserver />
      <FirstWelcomeDialog />
      <FounderSurprise />
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/profile/:id" component={ProfilePage} />
          <Route path="/p/:id" component={PostPage} />
          <Route path="/create" component={CreatePage} />
          <Route path="/notifications" component={NotificationsPage} />
          <Route path="/messages" component={MessagesPage} />
          <Route path="/messages/:id" component={ConversationPage} />
          <Route path="/saved" component={SavedPage} />
          <Route path="/tags/:tag" component={HashtagPage} />
          <Route path="/creator-hub" component={CreatorHubPage} />
          <Route path="/shared/:token" component={SharedPreviewPage} />
          <Route path="/collaboration/:ownerId/:universeId" component={CollaborationPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/music" component={EchoMusicPage} />
          <Route path="/settings/subscriptions" component={SubscriptionsPage} />
          <Route path="/help" component={HelpCenterPage} />
          <Route path="/admin/support" component={SupportAdminPage} />
          <Route path="/search" component={SearchPage} />
          <Route path="/characters/new" component={CharacterEditorPage} />
          <Route path="/characters/:id/edit" component={CharacterEditorPage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function SignInPage() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-4 flex justify-end"><PublicLanguageSelector /></div>
        <Link href="/" className="mb-5 block text-center wordmark text-2xl text-foreground">ECHO</Link>
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
          forceRedirectUrl={basePath || '/'}
        />
      </div>
    </main>
  );
}

function SignUpPage() {
  const language = useLanguage();
  const betaCopy: Record<Language, [string,string]> = {
    es: ["Antes de crear tu cuenta, ", "leé la información de la beta privada"],
    en: ["Before creating your account, ", "read the private beta information"],
    pt: ["Antes de criar sua conta, ", "leia as informações da beta privada"],
    fr: ["Avant de créer votre compte, ", "consultez les informations sur la bêta privée"],
    de: ["Bevor du dein Konto erstellst, ", "lies die Informationen zur privaten Beta"],
    it: ["Prima di creare il tuo account, ", "leggi le informazioni sulla beta privata"],
    ko: ["계정을 만들기 전에 ", "비공개 베타 안내를 읽어주세요"],
    ja: ["アカウントを作成する前に、", "プライベートベータの案内をご確認ください"],
    zh: ["创建账户前，请", "阅读私人测试版说明"],
  };
  const [betaPrefix, betaLink] = betaCopy[language];
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-4 flex justify-end"><PublicLanguageSelector /></div>
        <Link href="/" className="mb-5 block text-center wordmark text-2xl text-foreground">ECHO</Link>
        <p className="mb-4 text-center text-sm text-muted-foreground">{betaPrefix}<Link href="/beta-info" className="underline">{betaLink}</Link>.</p>
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in`}
          forceRedirectUrl={basePath || '/'}
        />
      </div>
    </main>
  );
}

function ConsentedExperience() {
  return <AlphaConsentBoundary><AuthenticatedExperience /></AlphaConsentBoundary>;
}

function AuthenticatedExperience() {
  const { isLoaded, isSignedIn, user } = useUser();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const activeUniverseId = user?.id ? getActiveUniverseId(user.id) : 'primary';
  const universeQuery = useGetUniverse({ universeId: activeUniverseId }, {
    query: {
      enabled: isLoaded && Boolean(isSignedIn && user?.id),
      queryKey: getGetUniverseQueryKey({ universeId: activeUniverseId }),
    },
  });
  const saveUniverseMutation = useSaveUniverse();
  useEffect(() => {
    const data = (universeQuery.error as { data?: { error?: string; ownerId?: string; fallbackUniverseId?: string } } | null)?.data;
    if (user?.id && data?.ownerId === user.id && data?.error === 'UNIVERSE_UNAVAILABLE' && data.fallbackUniverseId &&
      data.fallbackUniverseId !== activeUniverseId) {
      setActiveUniverseId(user.id, data.fallbackUniverseId);
      window.location.replace(import.meta.env.BASE_URL);
    }
  }, [user?.id, activeUniverseId, universeQuery.error]);
  const [legacyCheck, setLegacyCheck] = useState<{
    ownerId: string;
    status: 'checking' | 'present' | 'empty' | 'error';
  } | null>(null);
  const [legacyCheckAttempt, setLegacyCheckAttempt] = useState(0);
  const [onboardingResult, setOnboardingResult] = useState<UniverseEnvelope | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user?.id || universeQuery.data?.state !== null) {
      setLegacyCheck(null);
      return;
    }
    let current = true;
    setLegacyCheck({ ownerId: user.id, status: 'checking' });
    Promise.all([import.meta.env.VITE_ECHO_PRIVATE_BETA === 'true' ? Promise.resolve(null) : loadLegacyState(), loadRecovery(user.id)])
      .then(([legacy, recovery]) => {
        if (current) setLegacyCheck({
          ownerId: user.id,
          status: legacy || recovery ? 'present' : 'empty',
        });
      })
      .catch(() => {
        if (current) setLegacyCheck({ ownerId: user.id, status: 'error' });
      });
    return () => { current = false; };
  }, [isLoaded, isSignedIn, user?.id, universeQuery.data?.state, legacyCheckAttempt]);

  if (!isLoaded) return <EchoSplash />;
  if (!isSignedIn || !user) return <LandingPage />;
  if (universeQuery.isError) {
    const failure = universeQuery.error as { data?: { error?: string }; message?: string } | null;
    const betaError = failure?.data?.error;
    const betaFull = betaError === 'PRIVATE_BETA_FULL';
    const betaUnavailable = betaError === 'PRIVATE_BETA_UNAVAILABLE';
    return (
      <main className="echo-public ep-onboarding">
        <section className="ep-onboarding-main">
          <div className="ep-complete" role="alert" data-testid="status-universe-load-error">
            <span className="ep-eyebrow">{betaFull ? 'ECHO · BETA PRIVADA' : betaUnavailable ? 'Acceso temporalmente no disponible' : 'No se pudo cargar tu espacio'}</span>
            <h1>{betaFull ? 'Los tres lugares ya están ocupados.' : betaUnavailable ? 'Estamos preparando el acceso.' : 'Tu universo sigue protegido.'}</h1>
            <p>{betaFull ? 'Esta beta tiene solo tres cuentas de prueba. No se creó ningún universo en tu cuenta.' : betaUnavailable ? 'El acceso privado no está disponible en este momento. Volvé a intentarlo más tarde.' : 'Vuelve a intentarlo antes de continuar. No se creó ni se reemplazó ningún dato.'}</p>
            {!betaFull && <button type="button" className="ep-button" onClick={() => void universeQuery.refetch()} data-testid="button-retry-universe">
              Reintentar
            </button>}
          </div>
        </section>
      </main>
    );
  }
  if (universeQuery.isLoading || !universeQuery.data) return <AppSkeleton />;

  const isNewOwner = universeQuery.data.state === null;
  const hasCheckedLegacy = legacyCheck?.ownerId === user.id && legacyCheck.status !== 'checking';
  const hasLegacyData = legacyCheck?.ownerId === user.id && legacyCheck.status === 'present';
  const shouldOnboard = shouldShowCreatorOnboarding(universeQuery.data.state !== null, hasLegacyData);
  if (isNewOwner && !hasCheckedLegacy) return <AppSkeleton />;
  if (isNewOwner && legacyCheck?.ownerId === user.id && legacyCheck.status === 'error') {
    return (
      <main className="echo-public ep-onboarding">
        <section className="ep-onboarding-main">
          <div className="ep-complete" role="alert" data-testid="status-local-data-check-error">
            <span className="ep-eyebrow">Comprobación incompleta</span>
            <h1>No vamos a empezar todavía.</h1>
            <p>No pudimos comprobar si este navegador conserva datos anteriores. Reintenta para protegerlos antes de crear un universo nuevo.</p>
            <button type="button" className="ep-button" onClick={() => setLegacyCheckAttempt(attempt => attempt + 1)} data-testid="button-retry-local-check">
              Volver a comprobar
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (isNewOwner && shouldOnboard && legacyCheck?.ownerId === user.id && legacyCheck.status === 'empty') {
    const completeOnboarding = async (input: CreatorOnboardingInput) => {
      const state = createStarterUniverse(input);
      const saved = await saveUniverseMutation.mutateAsync({
        data: { state, expectedRevision: universeQuery.data.revision },
      });
      setOnboardingResult(saved);
    };
    return (
      <Switch>
        <Route path="/">
          <OnboardingPage
            saving={saveUniverseMutation.isPending}
            error={null}
            onComplete={completeOnboarding}
            onEnter={() => {
              if (!onboardingResult) return;
              queryClient.setQueryData(getGetUniverseQueryKey({ universeId: 'primary' }), onboardingResult);
              setLocation('/');
            }}
          />
        </Route>
        <Route path="/onboarding">
          <OnboardingPage
            saving={saveUniverseMutation.isPending}
            error={null}
            onComplete={completeOnboarding}
            onEnter={() => {
              if (!onboardingResult) return;
              queryClient.setQueryData(getGetUniverseQueryKey({ universeId: 'primary' }), onboardingResult);
              setLocation('/');
            }}
          />
        </Route>
        <Route component={NotFound} />
      </Switch>
    );
  }

  return (
    <SocialStoreProvider key={user.id} userId={user.id} fallback={<AppSkeleton />}>
      <AppearanceSync />
      <StoryViewerProvider>
        <ProtectedRouter />
      </StoryViewerProvider>
    </SocialStoreProvider>
  );
}

function ApiConnection({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const apiOrigin = import.meta.env.VITE_ECHO_API_ORIGIN?.trim();
    setBaseUrl(apiOrigin || null);
    setAuthTokenGetter(() => getToken());
    setReady(true);
    return () => {
      setAuthTokenGetter(null);
      setBaseUrl(null);
    };
  }, [getToken]);
  return ready ? <>{children}</> : <EchoSplash />;
}

function InterfaceLanguageSync() {
  const { user, isLoaded } = useUser();
  const language = useLanguage();
  const [readyForUser, setReadyForUser] = useState<string | null>(null);
  const lastLanguage = useRef<Language>(language);
  useEffect(() => {
    if (!isLoaded || !user?.id) { setReadyForUser(null); sessionStorage.removeItem('echo:language-ready-user'); return; }
    let cancelled = false;
    setReadyForUser(null);
    sessionStorage.removeItem('echo:language-ready-user');
    void customFetch<{ language: Language | null }>('/api/account/interface-language', { responseType: 'json' })
      .then(result => {
        if (cancelled) return;
        if (result.language) {
          lastLanguage.current = result.language;
          setLanguage(result.language);
        } else {
          lastLanguage.current = getLanguage();
          // First device establishes the initial account preference.
          void customFetch('/api/account/interface-language', { method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: lastLanguage.current }) }).catch(console.warn);
        }
        setReadyForUser(user.id);
        sessionStorage.setItem('echo:language-ready-user', user.id);
        window.dispatchEvent(new CustomEvent('echo:account-language-ready', { detail: { userId: user.id } }));
      })
      .catch(error => { if (!cancelled) console.warn('ECHO language sync unavailable', error); });
    return () => { cancelled = true; };
  }, [isLoaded, user?.id]);
  useEffect(() => {
    if (!user?.id || readyForUser !== user.id || lastLanguage.current === language) return;
    lastLanguage.current = language;
    void customFetch('/api/account/interface-language', { method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language }) }).catch(error => console.warn('ECHO language preference save failed', error));
  }, [language, readyForUser, user?.id]);
  // Keep the same account language across already-open devices, not only at login.
  useEffect(() => {
    if (!user?.id || readyForUser !== user.id) return;
    let active = true;
    let busy = false;
    const refresh = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const result = await customFetch<{ language: Language | null }>('/api/account/interface-language', { responseType: 'json' });
        if (!active || !result.language) return;
        // Never overwrite a local selection while its save is in flight.
        if (lastLanguage.current !== getLanguage()) return;
        if (result.language !== getLanguage()) {
          lastLanguage.current = result.language;
          setLanguage(result.language);
        }
      } catch (error) { console.warn('ECHO language refresh unavailable', error); }
      finally { busy = false; }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onFocus = () => { void refresh(); };
    const timer = window.setInterval(() => { void refresh(); }, 20000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [user?.id, readyForUser]);
  return null;
}

function ClerkQueryCacheInvalidator() {
  const { addListener } = useClerk();
  const prevUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserId.current !== undefined && prevUserId.current !== userId) {
        queryClient.clear();
      }
      prevUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener]);
  return null;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  const language = useLanguage();
  const clerkLocale = { es: esES, en: enUS, pt: ptBR, fr: frFR, de: deDE, it: itIT, ko: koKR, ja: jaJP, zh: zhCN }[language];
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={clerkLocale}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ApiConnection>
        <ClerkQueryCacheInvalidator />
        <InterfaceLanguageSync />
        <Switch>
          <Route path="/creator-preview" component={PublicReviewHub} />
          <Route path="/creator-preview/landing" component={() => <LandingPage previewMode />} />
          <Route path="/creator-preview/pricing" component={() => <PricingPage previewMode />} />
          <Route path="/creator-preview/faq" component={() => <FaqPage previewMode />} />
          <Route path="/creator-preview/sign-in" component={() => <AuthScreenPreview kind="sign-in" />} />
          <Route path="/creator-preview/sign-up" component={() => <AuthScreenPreview kind="sign-up" />} />
          <Route path="/creator-preview/account" component={CreatorAccountPreview} />
          <Route path="/creator-preview/universes" component={CreatorUniversePreview} />
          <Route path="/creator-preview/store" component={CreatorStorePreview} />
          <Route path="/creator-preview/privacy" component={CreatorPrivacyCenter} />
          <Route path="/creator-preview/limit" component={CreatorLimitPreview} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/beta-info" component={BetaInformationPage} />
          <Route path="/pricing" component={() => <PricingPage />} />
          <Route path="/faq" component={() => <FaqPage />} />
          <Route component={ConsentedExperience} />
        </Switch>
        </ApiConnection>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  if (!clerkPubKey) throw new Error('Falta la clave pública de Clerk para iniciar ECHO.');
  useEffect(() => {
    if (!document.documentElement.classList.contains('theme-light')) document.documentElement.classList.add('dark');
    document.documentElement.lang = getLanguage();
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <ClerkRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  );
}

export default App;
