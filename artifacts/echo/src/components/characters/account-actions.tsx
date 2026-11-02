import { useState } from 'react';
import { useLocation } from 'wouter';
import { Archive, ArchiveRestore, Copy, Trash2 } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { deletionBlockReason } from '@/domain/character-core';
import { inputCls } from '@/components/echo/field';
import { toast } from '@/hooks/use-toast';
import type { Character } from '@/domain/types';

export function AccountActions({ account, dirty }: { account: Character; dirty: boolean }) {
  const { state, actions } = useSocial();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<null | 'duplicate' | 'delete'>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const block = account.id === 'nela' ? 'Nela es la identidad principal y está protegida.' : deletionBlockReason(state, account.id);
  const run = (fn: () => void) => { setError(null); try { fn(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar.'); } };

  return (
    <section className="mt-10 border-t border-border pt-5" aria-label="Acciones de la cuenta" data-testid="section-character-account-actions">
      <h2 className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Cuenta</h2>
      <div className="mt-3 grid gap-2">
        {mode === 'duplicate' ? (
          <div className="rounded-2xl border border-border p-4 text-sm">
            <p className="text-muted-foreground">Se copia la configuración del personaje. <b className="text-foreground">No</b> se copian publicaciones, mensajes, seguidores ni memoria reciente.{dirty && ' Los cambios sin guardar no se incluyen.'}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setMode(null)} className="h-11 flex-1 rounded-xl bg-secondary" data-testid="button-cancel-duplicate">Cancelar</button>
              <button onClick={() => run(() => { const id = actions.duplicateAccount(account.id); toast({ title: 'Copia creada' }); navigate(`/characters/${id}/edit`); })} className="h-11 flex-1 rounded-xl bg-primary font-semibold text-primary-foreground" data-testid="button-confirm-duplicate">Duplicar</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setMode('duplicate')} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border text-sm" data-testid="button-duplicate-character"><Copy className="h-4 w-4" /> Duplicar personaje</button>
        )}
        {account.id !== 'nela' && (account.archived ? (
          <button onClick={() => run(() => { actions.archiveAccount(account.id, false); toast({ title: 'Cuenta restaurada' }); })} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-secondary text-sm font-semibold" data-testid="button-restore-character"><ArchiveRestore className="h-4 w-4" /> Restaurar cuenta</button>
        ) : (
          <button onClick={() => run(() => { actions.archiveAccount(account.id, true); toast({ title: 'Cuenta archivada', description: 'Su historial se conserva.' }); })} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border text-sm text-muted-foreground" data-testid="button-archive-character"><Archive className="h-4 w-4" /> Archivar (conserva historial)</button>
        ))}
        {block ? (
          <p className="rounded-2xl bg-secondary/60 p-3 text-[13px] text-muted-foreground" data-testid="text-delete-blocked">No se puede eliminar: {block}{account.id !== 'nela' && !account.archived && ' Podés archivarla en su lugar.'}</p>
        ) : mode === 'delete' ? (
          <div className="rounded-2xl border border-destructive/40 p-4">
            <label htmlFor="confirm-delete" className="text-sm text-muted-foreground">Esto es permanente. Escribí <b className="text-foreground">@{account.handle}</b> para confirmar.</label>
            <input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" className={`${inputCls} mt-2`} data-testid="input-confirm-delete" />
            <div className="mt-3 flex gap-2">
              <button onClick={() => { setMode(null); setTyped(''); }} className="h-11 flex-1 rounded-xl bg-secondary text-sm" data-testid="button-cancel-delete">Cancelar</button>
              <button disabled={typed.trim() !== `@${account.handle}`} onClick={() => run(() => { actions.deleteAccount(account.id); toast({ title: 'Cuenta eliminada' }); navigate('/settings'); })} className="h-11 flex-1 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-50" data-testid="button-confirm-delete">Eliminar</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setMode('delete')} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-destructive/40 text-sm text-destructive" data-testid="button-delete-character"><Trash2 className="h-4 w-4" /> Eliminar cuenta sin uso</button>
        )}
        {error && <p role="alert" className="text-sm text-destructive" data-testid="text-account-action-error">{error}</p>}
      </div>
    </section>
  );
}
