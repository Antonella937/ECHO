import { useMemo } from 'react';
import { Link } from 'wouter';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { PhotoGrid } from '@/components/echo/photo-grid';
import { EmptyState } from '@/components/echo/skeletons';
import { byDateDesc } from '@/hooks/use-social-selectors';

export default function SavedPage() {
  const { state, me } = useSocial();
  const back = useBack();
  const saved = useMemo(() => state.posts.filter((p) => p.savedBy.includes(me.id)).sort(byDateDesc), [state.posts, me.id]);
  return (
    <div>
      <TopBar title="Guardados" sub={`Solo ${me.name.split(' ')[0]} puede verlos`} onBack={back} />
      {saved.length === 0 ? (
        <EmptyState
          title="Nada guardado aún"
          body="Toca el marcador bajo cualquier foto para tenerla siempre a mano aquí."
          action={<Link href="/" className="inline-flex h-11 items-center rounded-full bg-secondary px-6 text-sm font-semibold" data-testid="link-saved-home">Ir al inicio</Link>}
        />
      ) : (
        <div className="pt-1">
          <PhotoGrid posts={saved} />
        </div>
      )}
    </div>
  );
}
