import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'wouter';
import { ChevronLeft, Send, Users } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { getActiveUniverseId } from '@/store/persistence';
import { useSocial } from '@/store/social-store';
import { useUser } from '@clerk/react';

type Group = { id: string; name: string; participantIds: string[] };
type GroupMessage = { id: string; senderId: string; text: string; createdAt: string };

export default function GroupConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const { me, character } = useSocial();
  const [, navigate] = useLocation();
  const [group, setGroup] = useState<Group | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const scope = new URLSearchParams({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id });
  useEffect(() => {
    if (!user?.id || !id) return;
    let active = true;
    const load = async () => {
      try {
        const [groups, thread] = await Promise.all([
          customFetch<{ groups: Group[] }>(`/api/group-dms?${scope}`, { method: 'GET', responseType: 'json' }),
          customFetch<{ messages: GroupMessage[] }>(`/api/group-dms/${encodeURIComponent(id)}/messages?${scope}`, { method: 'GET', responseType: 'json' }),
        ]);
        if (active) { setGroup(groups.groups.find(g => g.id === id) ?? null); setMessages(thread.messages); setError(''); }
      } catch { if (active) setError('No se pudo cargar el grupo.'); }
    };
    void load();
    const interval = window.setInterval(() => void load(), 10000);
    return () => { active = false; window.clearInterval(interval); };
  }, [id, user?.id, me.id]);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || !id || sending) return;
    setSending(true);
    try {
      await customFetch(`/api/group-dms/${encodeURIComponent(id)}/messages`, {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, text: message }),
      });
      setText('');
      const result = await customFetch<{ messages: GroupMessage[] }>(`/api/group-dms/${encodeURIComponent(id)}/messages?${scope}`, { method: 'GET', responseType: 'json' });
      setMessages(result.messages); setError('');
    } catch { setError('No se pudo enviar el mensaje.'); }
    finally { setSending(false); }
  };
  return <div className="flex h-[100dvh] min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <header className="z-30 shrink-0 border-b border-border/60 bg-background/95 pt-safe backdrop-blur-xl"><div className="flex h-16 min-w-0 items-center gap-3 px-2">
      <button onClick={() => navigate('/messages')} aria-label="Volver" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary"><ChevronLeft className="h-6 w-6" /></button>
      <div className="grid h-11 w-11 place-items-center rounded-full bg-secondary"><Users className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1"><h1 className="truncate text-[15px] font-semibold">{group?.name ?? 'Grupo'}</h1><p className="truncate text-xs text-muted-foreground">{group?.participantIds.map(x => character(x)?.name ?? x).join(', ')}</p></div>
    </div></header>
    <main className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-5" data-testid="group-messages">
      {messages.map(m => <div key={m.id} className={`flex ${m.senderId === me.id ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[85%] rounded-2xl px-4 py-2 ${m.senderId === me.id ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>
          {m.senderId !== me.id && <p className="mb-1 text-xs font-semibold">{character(m.senderId)?.name ?? 'Participante'}</p>}
          <p className="whitespace-pre-wrap break-words text-sm">{m.text}</p>
        </div>
      </div>)}
    </main>
    {error && <p role="alert" className="px-4 text-sm text-destructive">{error}</p>}
    <form onSubmit={send} className="flex shrink-0 items-center gap-2 border-t border-border bg-background px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
      <input value={text} onChange={e => setText(e.target.value)} maxLength={10000} placeholder="Mensaje al grupo…" className="h-11 min-w-0 flex-1 rounded-full bg-secondary px-4 outline-none" aria-label="Mensaje al grupo" />
      <button disabled={!text.trim() || sending} aria-label="Enviar mensaje" className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"><Send className="h-5 w-5" /></button>
    </form>
  </div>;
}
