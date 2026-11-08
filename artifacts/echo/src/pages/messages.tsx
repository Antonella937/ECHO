import { useMessagesText } from '@/lib/messages-translations';
import { useLanguage } from '@/lib/i18n';
import { useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useUser } from '@clerk/react';
import { getActiveUniverseId } from '@/store/persistence';
import { Link, useLocation } from 'wouter';
import { Bookmark, PenSquare, Search, X, Users, Archive, BellOff } from 'lucide-react';
import { VerifiedBadge } from '@/components/echo/verified-badge';
import { useSocial } from '@/store/social-store';
import { useThreads } from '@/hooks/use-social-selectors';
import { TopBar } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { Sheet } from '@/components/echo/sheet';
import { timeAgo } from '@/lib/media';
import { cn } from '@/lib/utils';

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default function MessagesPage() {
  const t = useMessagesText();
  const { user } = useUser();
  const { me, state, character, actions } = useSocial();
  const [groups, setGroups] = useState<{ id: string; name: string; participantIds: string[]; archived?: boolean; muted?: boolean }[]>([]);
  const [groupComposer, setGroupComposer] = useState(false);
  const [showArchivedGroups, setShowArchivedGroups] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [acceptedRequests, setAcceptedRequests] = useState<string[]>([]);
  const [rejectedRequests, setRejectedRequests] = useState<string[]>([]);
  const requestStorageKey = `echo-dm-requests:${user?.id ?? 'anonymous'}:${me.id}`;
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(requestStorageKey) ?? '{}') as { accepted?: string[]; rejected?: string[] };
      setAcceptedRequests(Array.isArray(value.accepted) ? value.accepted : []);
      setRejectedRequests(Array.isArray(value.rejected) ? value.rejected : []);
    } catch { setAcceptedRequests([]); setRejectedRequests([]); }
  }, [requestStorageKey]);
  const updateRequest = (id: string, accept: boolean) => {
    const accepted = accept ? [...new Set([...acceptedRequests, id])] : acceptedRequests.filter(x => x !== id);
    const rejected = accept ? rejectedRequests.filter(x => x !== id) : [...new Set([...rejectedRequests, id])];
    setAcceptedRequests(accepted); setRejectedRequests(rejected);
    localStorage.setItem(requestStorageKey, JSON.stringify({ accepted, rejected }));
  };
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const load = () => customFetch<{ groups: typeof groups }>(`/api/group-dms?${new URLSearchParams({ universeId: getActiveUniverseId(user.id), actorId: me.id })}`, { method: 'GET', responseType: 'json' }).then(result => { if (active) setGroups(result.groups); }).catch(() => undefined);
    void load();
    return () => { active = false; };
  }, [user?.id, me.id, groupComposer]);
  const [showSaved, setShowSaved] = useState(() => new URLSearchParams(window.location.search).get("tab") === "favorites");
  const savedMessages = useMemo(() => state.messages.filter(m => m.savedByIds?.includes(me.id) && !m.hiddenForIds?.includes(me.id) && (m.senderId === me.id || m.recipientId === me.id)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)), [state.messages, me.id]);
  const threads = useThreads();
  const followed = new Set(state.follows[me.id] ?? []);
  const requests = threads.filter(({ other }) =>
    !followed.has(other.id) &&
    !acceptedRequests.includes(other.id) && !rejectedRequests.includes(other.id) &&
    !state.messages.some(m => m.senderId === me.id && m.recipientId === other.id)
  );
  const visibleThreads = threads.filter(({ other }) => showRequests
    ? requests.some(r => r.other.id === other.id)
    : !requests.some(r => r.other.id === other.id) && !rejectedRequests.includes(other.id));
  const [composing, setComposing] = useState(false);
  const [, navigate] = useLocation();
  const backToInbox = () => { if (showSaved) { setShowSaved(false); window.history.replaceState(null, "", "/messages"); } else navigate("/"); };
  const toggleFavorites = () => { setShowSaved(value => { const next = !value; window.history.replaceState(null, "", next ? "/messages?tab=favorites" : "/messages"); return next; }); };

  return (
    <div>
      <TopBar
        title={t("Mensajes")}
        onBack={backToInbox}
        sub={`${t("Bandeja de")} ${me.name}`}
        right={
          <div className="flex items-center gap-1">
          <button type="button" onClick={toggleFavorites} aria-label={t('Mensajes favoritos')} aria-pressed={showSaved} className={cn('tap flex h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold', showSaved ? 'bg-primary text-primary-foreground' : 'bg-secondary')} data-testid="button-saved-messages"><Bookmark className="h-[18px] w-[18px]" /> <span className="hidden min-[430px]:inline">{t('Favoritos')}</span></button>
          <button type="button" onClick={() => setShowRequests(v => !v)} aria-label={showRequests ? 'Mostrar conversaciones' : 'Solicitudes de mensajes'} aria-pressed={showRequests} className={cn('tap flex h-11 items-center gap-2 rounded-full px-3 text-sm', showRequests ? 'bg-primary text-primary-foreground' : 'bg-secondary')}><span>Solicitudes{requests.length > 0 ? ` (${requests.length})` : ''}</span></button>
          <button type="button" onClick={() => setShowArchivedGroups(v => !v)} aria-label={showArchivedGroups ? 'Mostrar grupos activos' : 'Mostrar grupos archivados'} aria-pressed={showArchivedGroups} className={cn('tap flex h-11 items-center gap-2 rounded-full px-3 text-sm', showArchivedGroups ? 'bg-primary text-primary-foreground' : 'bg-secondary')}><Archive className="h-[18px] w-[18px]" /></button>
          <button type="button" onClick={() => setGroupComposer(true)} aria-label="Nuevo grupo" className="tap flex h-11 items-center gap-2 rounded-full bg-secondary px-3 text-sm font-semibold"><Users className="h-[18px] w-[18px]" /><span className="hidden min-[430px]:inline">Grupo</span></button>
          <button
            onClick={() => setComposing(true)}
            aria-label={t("Nueva conversación")}
            className="tap flex h-11 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-semibold hover:bg-secondary/80"
            data-testid="button-new-conversation"
          >
            <PenSquare className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
            <span className="hidden min-[380px]:inline">{t("Nueva")}</span>
          </button>
          </div>
        }
      />
      {showSaved ? (
        <section className="px-3 pt-4" data-testid="list-saved-messages">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">{t('Mensajes favoritos')}</h2><span className="text-xs text-muted-foreground">{savedMessages.length}</span></div>
          {savedMessages.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">{t('Todavía no guardaste ningún mensaje. Tocá el marcador de un mensaje para encontrarlo aquí.')}</p> : (
            <ul className="space-y-2">{savedMessages.map(m => { const otherId = m.senderId === me.id ? m.recipientId : m.senderId; const other = character(otherId); return <li key={m.id} className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card p-3">
              {other && <CharacterAvatar character={other} size={40} />}
              <Link href={`/messages/${otherId}?saved=${encodeURIComponent(m.id)}`} className="min-w-0 flex-1" data-testid={`link-saved-message-${m.id}`}><p className="text-xs font-semibold">{other?.name ?? t('Conversación')} · {timeAgo(m.createdAt)}</p><p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{m.text || (m.attachments?.length ? t('Archivo adjunto') : t('Mensaje'))}</p></Link>
              <button type="button" onClick={() => actions.toggleSaveMessage(m.id)} aria-label={t('Quitar de favoritos')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-secondary" data-testid={`button-unsave-message-${m.id}`}><Bookmark className="h-5 w-5 fill-primary text-primary" /></button>
            </li>; })}</ul>
          )}
        </section>
      ) : visibleThreads.length === 0 && (showRequests || groups.filter(g => Boolean(g.archived) === showArchivedGroups).length === 0) ? (
        <div className="flex flex-col items-center px-8 py-20 text-center" data-testid="empty-messages">
          <div className="mb-5 grid h-16 w-16 place-items-center rounded-full border border-dashed border-primary/40 text-primary">
            <PenSquare className="h-6 w-6" strokeWidth={1.5} />
          </div>
          <p className="font-display text-xl font-light tracking-wide">{t("Aún no hay mensajes")}</p>
          <p className="mt-2 max-w-[280px] text-sm leading-relaxed text-muted-foreground">
            {t('Escribe a alguien de tu universo. La conversación aparecerá aquí cuando envíes el primer mensaje.')}
          </p>
          <button
            onClick={() => setComposing(true)}
            className="tap mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground"
            data-testid="button-empty-new-conversation"
          >
            <PenSquare className="h-4 w-4" strokeWidth={2} /> {t("Nueva conversación")}
          </button>
        </div>
      ) : (
        <ul className="px-1 pt-3" data-testid="list-threads">
          {!showRequests && groups.filter(group => Boolean(group.archived) === showArchivedGroups).map(group => <li key={group.id}><Link href={`/messages/group/${group.id}`} className="flex min-h-[72px] items-center gap-3.5 rounded-2xl px-3 py-3 hover:bg-secondary/60"><div className="grid h-[52px] w-[52px] place-items-center rounded-full bg-secondary"><Users className="h-6 w-6" /></div><div className="min-w-0 flex-1"><p className="truncate font-semibold">{group.name}</p><p className="truncate text-xs text-muted-foreground">{group.participantIds.map(id => character(id)?.name ?? id).join(", ")}</p></div>{group.muted && <BellOff className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Silenciado" />}</Link></li>)}
          {visibleThreads.map(({ other, last, unread }) => (
            <li key={other.id}>
              <Link href={`/messages/${other.id}`} className="flex min-h-[72px] items-center gap-3.5 rounded-2xl px-3 py-3 hover:bg-secondary/60" data-testid={`link-thread-${other.id}`}>
                <CharacterAvatar character={other} size={52} />
                <div className="min-w-0 flex-1">
                  <div className={cn('flex min-w-0 items-center gap-1 text-[15px]', unread ? 'font-semibold' : 'font-medium')}>
                    <span className="truncate">{other.name}</span>
                    <VerifiedBadge account={other} className="h-3.5 w-3.5 shrink-0" />
                  </div>
                  <div className={cn('truncate text-[13.5px]', unread ? 'text-foreground' : 'text-muted-foreground')}>
                    {last
                      ? `${last.senderId === me.id ? t("Tú: ") : ''}${last.storyId ? t("Respondió a una historia · ") : last.postId ? t("Compartió una foto · ") : ''}${last.text || (last.attachments?.length ? (last.attachments[0].type === 'image' ? t("Foto") : last.attachments[0].type === 'video' ? t("Video") : t("Nota de voz")) : '')}`
                      : `@${other.handle}`}
                    {last && <span className="text-muted-foreground"> · {timeAgo(last.createdAt)}</span>}
                  </div>
                </div>
                {unread > 0 && (
                  <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground" data-testid={`badge-unread-${other.id}`}>
                    {unread}
                  </span>
                )}
              </Link>
              {showRequests && <div className="mb-2 flex gap-2 px-3"><button type="button" onClick={() => updateRequest(other.id, true)} className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">Aceptar</button><button type="button" onClick={() => updateRequest(other.id, false)} className="rounded-xl bg-secondary px-4 py-2 text-xs font-semibold">Rechazar</button></div>}
            </li>
          ))}
        </ul>
      )}
      <p className="px-6 pt-6 text-center text-[11.5px] leading-relaxed text-muted-foreground/70">
        {t('Los personajes con autonomía activada pueden responderte por aquí. Las respuestas pueden tardar unos minutos.')}
      </p>
      <NewConversationSheet open={composing} onClose={() => setComposing(false)} />
      <NewGroupSheet open={groupComposer} onClose={() => setGroupComposer(false)} />
    </div>
  );
}

function NewConversationSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useMessagesText();
  const language = useLanguage();
  const { state, me } = useSocial();
  const [, navigate] = useLocation();
  const [q, setQ] = useState('');
  const accounts = useMemo(() => {
    const term = normalize(q.trim().replace(/^@/, ''));
    return state.characters
      .filter((c) => c.id !== me.id && !c.archived)
      .filter((c) => !term || normalize(c.name).includes(term) || normalize(c.handle).includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, language));
  }, [state.characters, me.id, q]);

  const close = () => {
    setQ('');
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={t("Nueva conversación")} testId="sheet-new-conversation">
      <label className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 rounded-2xl border border-input bg-background px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Buscar por nombre o @usuario")}
          aria-label={t("Buscar cuenta")}
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground focus:outline-none"
          data-testid="input-search-accounts"
        />
      </label>
      {accounts.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="text-no-accounts">
          {q ? t('Ninguna cuenta coincide con tu búsqueda.') : t('No hay otras cuentas activas.')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {accounts.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  close();
                  navigate(`/messages/${c.id}`);
                }}
                className="tap flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-secondary/70"
                data-testid={`button-choose-account-${c.id}`}
              >
                <CharacterAvatar character={c} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1 text-[15px] font-medium">
                    <span className="truncate">{c.name}</span>
                    <VerifiedBadge account={c} className="h-3.5 w-3.5 shrink-0" />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">@{c.handle}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function NewGroupSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { user } = useUser();
  const { me, state } = useSocial();
  const [, navigate] = useLocation();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const members = state.characters.filter(c => c.id !== me.id && !c.archived);
  const create = async () => {
    if (!name.trim() || selected.length < 2 || saving || !user?.id) return;
    setSaving(true); setError('');
    try {
      const group = await customFetch<{ id: string }>('/api/group-dms', {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user.id), actorId: me.id, name: name.trim(), participantIds: selected }),
      });
      onClose(); setName(''); setSelected([]); navigate(`/messages/group/${group.id}`);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : '';
      setError(detail ? `No se pudo crear el grupo: ${detail}` : 'No se pudo crear el grupo. Intentá nuevamente.');
    }
    finally { setSaving(false); }
  };
  return <Sheet open={open} onClose={onClose} title="Nuevo grupo" testId="sheet-new-group">
    <label className="block text-sm font-medium">Nombre del grupo</label>
    <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Ej. PRETTY VIOLENCE" className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3" />
    <p className="mt-5 mb-2 text-sm font-medium">Seleccioná al menos dos participantes</p>
    <div className="max-h-72 space-y-1 overflow-y-auto">{members.map(c => <label key={c.id} className="flex min-h-12 items-center gap-3 rounded-xl px-2 hover:bg-secondary">
      <input type="checkbox" checked={selected.includes(c.id)} onChange={e => setSelected(old => e.target.checked ? [...old, c.id] : old.filter(id => id !== c.id))} />
      <CharacterAvatar character={c} size={36} /><span className="text-sm">{c.name}</span>
    </label>)}</div>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <button onClick={() => void create()} disabled={!name.trim() || selected.length < 2 || saving} className="mt-5 h-11 w-full rounded-full bg-primary font-semibold text-primary-foreground disabled:opacity-50">Crear grupo</button>
  </Sheet>;
}
