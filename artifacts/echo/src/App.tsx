import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { esES } from '@clerk/localizations';
import { shadcn } from '@clerk/themes';
import {
  getGetUniverseQueryKey,
  useGetUniverse,
  useSaveUniverse,
  type UniverseEnvelope,
  setBaseUrl,
  setAuthTokenGetter,
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

function ProtectedRouter() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return (
    <Shell>
      <MessageSoundObserver />
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
          <Route path="/settings" component={SettingsPage} />
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
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-[440px]">
        <Link href="/" className="mb-5 block text-center wordmark text-2xl text-foreground">ECHO</Link>
        <p className="mb-4 text-center text-sm text-muted-foreground">Antes de crear tu cuenta, <Link href="/beta-info" className="underline">leé la información de la beta privada</Link>.</p>
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
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        ...esES,
        signIn: {
          ...esES.signIn,
          start: {
            ...(esES.signIn?.start ?? {}),
            title: 'Te damos la bienvenida',
            subtitle: 'Inicia sesión para volver a tu universo.',
          },
        },
        signUp: {
          ...esES.signUp,
          start: {
            ...(esES.signUp?.start ?? {}),
            title: 'Crea tu espacio privado',
            subtitle: 'Tus personajes y recuerdos estarán en tu cuenta.',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ApiConnection>
        <ClerkQueryCacheInvalidator />
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
    document.documentElement.lang = 'es';
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
