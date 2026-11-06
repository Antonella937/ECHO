import { useDiscoveryText } from '@/lib/discovery-translations';
import { useMemo, useRef } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { Search, X } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { searchHref, searchUniverse } from '@/domain/universe-search';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { VerifiedBadge } from '@/components/echo/verified-badge';
import { PhotoGrid } from '@/components/echo/photo-grid';
import { EmptyState } from '@/components/echo/skeletons';

export default function SearchPage() {
  const t = useDiscoveryText();
  const { state, storageError } = useSocial();
  const back = useBack();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const query = params.get('q') ?? '';
  const location = params.get('location') ?? '';
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchUniverse(state, query, location), [state.characters, state.posts, query, location]);
  const empty = !results.characters.length && !results.posts.length && !results.tags.length;

  return (
    <div>
      <TopBar title={t("Buscar")} onBack={back} sub={state.creatorSetup?.universeName || t('Tu universo')} />
      <div className="px-4 pb-5 pt-4">
        <form role="search" onSubmit={event => { event.preventDefault(); input.current?.focus(); }}>
          <label className="flex h-12 items-center gap-3 rounded-2xl border border-border bg-card px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input ref={input} type="search" value={query}
              onChange={event => navigate(searchHref(event.target.value, location), { replace: true })}
              placeholder={t("Personajes, publicaciones o #hashtags")} aria-label={t("Buscar en este universo")}
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground focus:outline-none"
              data-testid="input-universe-search" />
          </label>
        </form>
        {location && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-secondary px-3">
            <span className="min-w-0 flex-1 break-words text-sm">{location}</span>
            <button type="button" aria-label={t("Quitar filtro de ubicación")}
              className="tap grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-card"
              onClick={() => navigate(searchHref(query), { replace: true })}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {storageError && <p role="alert" className="mt-3 break-words text-sm text-destructive">
          No se pudo sincronizar el universo. Los resultados usan los datos disponibles en este dispositivo.
        </p>}
        <p role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground">
          {results.active ? `${results.characters.length} ${t('personajes')} · ${results.posts.length} ${t('publicaciones')} · ${results.tags.length} ${t('hashtags')}` : t('Solo se busca dentro del universo activo.')}
        </p>
      </div>
      {!results.active ? (
        <EmptyState title={t("Encuentra algo de tu mundo")} body={t("Busca personajes, publicaciones o hashtags de este universo.")} />
      ) : empty ? (
        <EmptyState title={t("Sin resultados")} body={t("No encontramos coincidencias en este universo. Prueba con otra búsqueda.")} />
      ) : (
        <div className="pb-6">
          {!!results.characters.length && <section aria-labelledby="search-characters" className="px-4">
            <h2 id="search-characters" className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t("Personajes")}</h2>
            <ul>
              {results.characters.map(character => <li key={character.id}>
                <Link href={`/profile/${character.id}`} className="tap flex min-h-[60px] items-center gap-3 rounded-2xl px-2 py-2 hover:bg-secondary/70">
                  <CharacterAvatar character={character} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1 text-[15px] font-medium">
                      <span className="truncate">{character.name}</span><VerifiedBadge account={character} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">@{character.handle}</span>
                  </span>
                </Link>
              </li>)}
            </ul>
          </section>}
          {!!results.tags.length && <section aria-labelledby="search-tags" className="mt-5 px-4">
            <h2 id="search-tags" className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t("Hashtags")}</h2>
            <div className="flex flex-wrap gap-2">
              {results.tags.map(tag => <Link key={tag} href={`/tags/${encodeURIComponent(tag)}`}
                className="tap inline-flex min-h-11 max-w-full items-center rounded-xl bg-secondary px-3 py-2 text-sm text-primary">
                <span className="break-all">#{tag}</span>
              </Link>)}
            </div>
          </section>}
          {!!results.posts.length && <section aria-labelledby="search-posts" className="mt-5">
            <h2 id="search-posts" className="mb-3 px-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t("Publicaciones")}</h2>
            <PhotoGrid posts={results.posts} />
          </section>}
        </div>
      )}
    </div>
  );
}
