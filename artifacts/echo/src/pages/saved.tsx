import { useSavedText } from '@/lib/saved-translations';
import { useMemo } from 'react';
import { Link } from 'wouter';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { PhotoGrid } from '@/components/echo/photo-grid';
import { EmptyState } from '@/components/echo/skeletons';
import { byDateDesc } from '@/hooks/use-social-selectors';

export default function SavedPage() {
  const { state, me } = useSocial();
  const t = useSavedText();
  const back = useBack();
  const saved = useMemo(() => state.posts.filter((p) => p.savedBy.includes(me.id)).sort(byDateDesc), [state.posts, me.id]);
  return (
    <div>
      <TopBar title={t('Guardados')} sub={t('Solo {name} puede verlos').replace('{name}', me.name.split(' ')[0])} onBack={back} />
      {saved.length === 0 ? (
        <EmptyState
          title={t('Nada guardado aún')}
          body={t('Toca el marcador bajo cualquier foto para tenerla siempre a mano aquí.')}
          action={<Link href="/" className="inline-flex h-11 items-center rounded-full bg-secondary px-6 text-sm font-semibold" data-testid="link-saved-home">{t('Ir al inicio')}</Link>}
        />
      ) : (
        <div className="pt-1">
          <PhotoGrid posts={saved} />
        </div>
      )}
    </div>
  );
}
