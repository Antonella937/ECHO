import { useEffect, useRef } from 'react';
import { useUser } from '@clerk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSocial } from '@/store/social-store';
import { getActiveUniverseId } from '@/store/persistence';
import {
  createSocialFeedContext,
  requestSocialFeedPage,
  socialFeedQueryKey,
  type SocialFeedPageOptions,
} from '@/lib/social-feed-client';

/** Authenticated single-page caller for the read-only cross-owner feed API. */
export function useSocialFeedPage(options: SocialFeedPageOptions = {}) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { state } = useSocial();
  const queryClient = useQueryClient();
  const ownerId = user?.id ?? null;
  const activeUniverseId = ownerId ? getActiveUniverseId(ownerId) : null;
  const context = createSocialFeedContext(
    { isLoaded, isSignedIn: Boolean(isSignedIn), ownerId },
    activeUniverseId,
    state,
  );
  const previousOwnerId = useRef<string | null>(null);

  useEffect(() => {
    if (previousOwnerId.current && previousOwnerId.current !== context?.ownerId) {
      queryClient.removeQueries({ queryKey: ['social-feed-page'] });
    }
    previousOwnerId.current = context?.ownerId ?? null;
  }, [context?.ownerId, queryClient]);

  const query = useQuery({
    queryKey: socialFeedQueryKey(context, options),
    queryFn: ({ signal }) => requestSocialFeedPage(context, options, fetch, signal),
    enabled: context !== null,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  return { ...query, context, enabled: context !== null };
}
