import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SocialStoreProvider } from '@/store/social-store';
import { StoryViewerProvider } from '@/components/echo/story-viewer';
import { Shell } from '@/components/echo/shell';
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

const queryClient = new QueryClient();

function Router() {
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
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.lang = 'es';
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <SocialStoreProvider fallback={<AppSkeleton />}>
              <StoryViewerProvider>
                <Router />
              </StoryViewerProvider>
            </SocialStoreProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

export default App;
