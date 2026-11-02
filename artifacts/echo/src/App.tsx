import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { esES } from '@clerk/localizations';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SocialStoreProvider } from '@/store/social-store';
import { StoryViewerProvider } from '@/components/echo/story-viewer';
import { Shell } from '@/components/echo/shell';
import { AppearanceSync } from '@/components/echo/appearance-sync';
import HashtagPage from '@/pages/hashtag';
import { AppSkeleton } from '@/components/echo/skeletons';
import HomePage from '@/pages/home';
import ProfilePage from '@/pages/profile';
import PostPage from '@/pages/post';
import CreatePage from '@/pages/create';
import NotificationsPage from '@/pages/notifications';
import MessagesPage from '@/pages/messages';
import ConversationPage from '@/pages/conversation';
import SavedPage from '@/pages/saved';
import SettingsPage from '@/pages/settings';
import NotFound from '@/pages/not-found';
import CharacterEditorPage from '@/pages/character-editor';

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
          <Route path="/characters/new" component={CharacterEditorPage} />
          <Route path="/characters/:id/edit" component={CharacterEditorPage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function LandingPage() {
  return (
    <main className="grain grid min-h-[100dvh] place-items-center bg-background px-6 text-foreground">
      <section className="w-full max-w-md py-14 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] border border-primary/25 bg-accent/60 text-primary">
          <span className="wordmark text-2xl">E</span>
        </div>
        <p className="mt-6 text-[11px] uppercase tracking-[0.24em] text-primary">Un universo privado</p>
        <h1 className="mt-3 font-display text-5xl font-light tracking-wide">ECHO</h1>
        <p className="mx-auto mt-4 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
          Las fotos, conversaciones y personajes de Nela, guardados de forma privada y disponibles cuando inicias sesión.
        </p>
        <div className="mx-auto mt-8 grid max-w-xs gap-3">
          <Link href="/sign-up" className="grid h-12 place-items-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground">
            Crear una cuenta
          </Link>
          <Link href="/sign-in" className="grid h-12 place-items-center rounded-2xl border border-border bg-card text-sm font-semibold hover:bg-secondary">
            Ya tengo una cuenta
          </Link>
        </div>
        <p className="mt-6 text-xs text-muted-foreground/75">Un espacio personal. Nela es tu identidad principal.</p>
      </section>
    </main>
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

function AuthenticatedExperience() {
  const { isLoaded, isSignedIn, user } = useUser();
  if (!isLoaded) return <AppSkeleton />;
  if (!isSignedIn || !user) return <LandingPage />;
  return (
    <SocialStoreProvider key={user.id} userId={user.id} fallback={<AppSkeleton />}>
      <AppearanceSync />
      <StoryViewerProvider>
        <ProtectedRouter />
      </StoryViewerProvider>
    </SocialStoreProvider>
  );
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
        <ClerkQueryCacheInvalidator />
        <Switch>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route component={AuthenticatedExperience} />
        </Switch>
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
