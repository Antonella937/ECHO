import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { Sheet } from './sheet';
import { AvatarPicker } from './avatar-picker';
import { Field, inputCls, parseBase } from './field';
import { accountTypes, type AccountInput } from '@/domain/accounts';
import { realFollowCounts } from './account-stats';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Character } from '@/domain/types';

type AccountType = NonNullable<Character['accountType']>;

interface Props {
  open: boolean;
  onClose(): void;
  /** Account to edit; omit/null to create a new one. */
  accountId?: string | null;
  onCreated?(id: string): void;
}

export function AccountEditor({ open, onClose, accountId, onCreated }: Props) {
  const { state, character, actions } = useSocial();
  const account = accountId ? character(accountId) : undefined;
  const isNew = !accountId;
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('asset:account-default');
  const [type, setType] = useState<AccountType>('personal');
  const [verified, setVerified] = useState(false);
  const [followers, setFollowers] = useState('');
  const [following, setFollowing] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const saving = useRef(false);
  const original = useRef<AccountInput | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    original.current = account ? structuredClone(account) : undefined;
    setName(account?.name ?? '');
    setHandle(account?.handle ?? '');
    setBio(account?.bio ?? '');
    setAvatar(account?.avatar ?? 'asset:account-default');
    setType(account?.accountType ?? 'personal');
    setVerified(account?.verified ?? false);
    setFollowers(account?.displayMetrics?.followers?.toString() ?? '');
    setFollowing(account?.displayMetrics?.following?.toString() ?? '');
    setError(null);
    setConfirmArchive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  const real = account ? realFollowCounts(state, account.id) : { followers: 0, following: 0 };

  const save = () => {
    if (saving.current || uploading) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const input: AccountInput = {
        name, handle: handle.toLowerCase(), bio, avatar, accountType: type, verified,
        displayMetrics: { followers: parseBase(followers), following: parseBase(following) },
      };
      if (isNew) {
        const id = actions.createAccount(input);
        toast({ title: `Cuenta @${input.handle.replace(/^@/, '')} creada` });
        onCreated?.(id);
      } else {
        actions.updateAccount(accountId!, input, original.current);
        toast({ title: 'Perfil actualizado' });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const toggleArchive = (archived: boolean) => {
    try {
      actions.archiveAccount(accountId!, archived);
      toast({ title: archived ? 'Cuenta archivada' : 'Cuenta restaurada' });
      setConfirmArchive(false);
      if (archived) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar.');
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isNew ? 'Nueva cuenta' : 'Editar perfil'}
      testId="sheet-account-editor"
      footer={
        <div className="flex gap-2 pb-2">
          <button onClick={onClose} className="h-12 flex-1 rounded-2xl bg-secondary text-sm font-medium" data-testid="button-cancel-account">Cancelar</button>
          <button onClick={save} disabled={busy || uploading} className="h-12 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60" data-testid={isNew ? 'button-create-account-submit' : 'button-save-account'}>
            {uploading ? 'Esperando foto…' : isNew ? 'Crear cuenta' : 'Guardar'}
          </button>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <AvatarPicker value={avatar} onChange={setAvatar} onBusy={setUploading} />
        <Field id="acc-name" label="Nombre" hint={`${name.length}/80`}>
          <input id="acc-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={inputCls} autoComplete="off" data-testid="input-account-name" />
        </Field>
        <Field id="acc-handle" label="@username" hint="Minúsculas, números, puntos y guiones bajos. Máx. 30.">
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
            <input id="acc-handle" value={handle} maxLength={31} autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/^@/, ''))} className={cn(inputCls, 'pl-8')} data-testid="input-account-handle" />
          </div>
        </Field>
        <Field id="acc-bio" label="Bio" hint={`${bio.length}/500`}>
          <textarea id="acc-bio" value={bio} maxLength={500} rows={3} onChange={(e) => setBio(e.target.value)}
            className={cn(inputCls, 'h-auto resize-none py-3 leading-relaxed')} data-testid="input-account-bio" />
        </Field>
        <Field id="acc-type" label="Tipo de cuenta">
          <select id="acc-type" value={type} onChange={(e) => setType(e.target.value as AccountType)} className={inputCls} data-testid="select-account-type">
            {Object.entries(accountTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <label className="mt-4 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl border border-border px-4">
          <span className="text-sm">Insignia verificada</span>
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" data-testid="checkbox-account-verified" />
        </label>

        <div className="mt-6 rounded-2xl bg-accent/30 p-3 text-[13px] leading-relaxed text-muted-foreground">
          <b className="text-foreground">Base visual</b>: cifra ficticia que se suma a los seguimientos reales del universo. Nunca crea seguidores. Déjala vacía para usar solo la actividad real.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="acc-followers" label="Base visual · seguidores" hint={`Reales: ${real.followers}`}>
            <input id="acc-followers" inputMode="numeric" value={followers} onChange={(e) => setFollowers(e.target.value)} placeholder="Vacío" className={inputCls} data-testid="input-base-followers" />
          </Field>
          <Field id="acc-following" label="Base visual · seguidos" hint={`Reales: ${real.following}`}>
            <input id="acc-following" inputMode="numeric" value={following} onChange={(e) => setFollowing(e.target.value)} placeholder="Vacío" className={inputCls} data-testid="input-base-following" />
          </Field>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-destructive" data-testid="text-account-error">{error}</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>

      {account && account.id !== 'nela' && (
        <div className="mt-8 border-t border-border pt-5">
          {account.archived ? (
            <button onClick={() => toggleArchive(false)} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-secondary text-sm font-semibold" data-testid="button-restore-account">
              <ArchiveRestore className="h-4 w-4" /> Restaurar cuenta
            </button>
          ) : confirmArchive ? (
            <div className="rounded-2xl border border-destructive/40 p-4">
              <p className="text-sm text-muted-foreground">Se ocultará de la lista de identidades. Sus publicaciones, mensajes e historial se conservan y podrás restaurarla cuando quieras.</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setConfirmArchive(false)} className="h-11 flex-1 rounded-xl bg-secondary text-sm" data-testid="button-cancel-archive">Cancelar</button>
                <button onClick={() => toggleArchive(true)} className="h-11 flex-1 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground" data-testid="button-confirm-archive">Archivar</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmArchive(true)} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border text-sm text-muted-foreground" data-testid="button-archive-account">
              <Archive className="h-4 w-4" /> Archivar cuenta
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
