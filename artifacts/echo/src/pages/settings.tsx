import { useClerk, useUser } from '@clerk/react';
import { useState } from 'react';
import { Check, ChevronDown, Cloud, Info, LogOut, Monitor, Moon, Palette, Search, Sun, Star, Music2 } from 'lucide-react';
import { Link } from 'wouter';
import { ACCENT_PRESETS, DEFAULT_APPEARANCE } from '@/components/echo/appearance-sync';
import type { Appearance, ImageStyle } from '@/domain/types';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { AccountManager } from '@/components/echo/account-manager';
import { UniverseSelector } from '@/components/echo/universe-selector';
import { AutonomySettingsSection } from '@/components/echo/autonomy-settings';
import { MessageSoundSettings } from '@/components/echo/message-sound-settings';
import { MusicConnectionsSection } from '@/components/echo/music-connections-section';
import { PushNotificationSettings } from '@/components/echo/push-notification-settings';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useSettingsText } from '@/lib/settings-translations';
import { LANGUAGES, setLanguage, useLanguage, useTranslation, type Language } from '@/lib/i18n';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

import { NelaEasterEgg } from '@/components/branding/echo-brand';

export default function SettingsPage() {
  const { state, me, actions, storageError, lastSavedAt } = useSocial();
  const { user } = useUser();
  const { signOut } = useClerk();
  const back = useBack();
  const t = useTranslation();
  const st = useSettingsText();
  const language = useLanguage();
  const closeFriendContacts = state.characters.filter(c => c.id !== me.id && !c.archived && (state.follows[me.id] ?? []).includes(c.id) && (state.follows[c.id] ?? []).includes(me.id));

  return (
    <div>
      <TopBar title={t("settings")} onBack={back} />
      <div className="px-4 pb-12 pt-5">
        <section aria-labelledby="account-h">
          <h2 id="account-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Tu cuenta")}</h2>
          <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
            <div className="text-sm font-semibold">{user?.fullName || st('Cuenta ECHO')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{user?.primaryEmailAddress?.emailAddress || st('Sesión protegida')}</div>
            <button
              type="button"
              onClick={() => void signOut({ redirectUrl: basePath || '/' })}
              className="mt-4 flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
              data-testid="button-sign-out"
            >
              <LogOut className="h-4 w-4" /> {st("Cerrar sesión")}
            </button>
          </div>
        <Link href="/creator-hub" className="mt-4 flex min-h-14 items-center justify-between rounded-2xl border border-border bg-card/60 px-4 text-sm font-semibold lg:hidden" data-testid="link-creator-hub-mobile"><span className="flex items-center gap-3"><Palette className="h-5 w-5 text-primary" /> Creator Hub</span><span className="text-xs text-muted-foreground">{st("Tu perfil de creador ›")}</span></Link>

          <Link href="/music" className="mt-3 flex min-h-14 items-center justify-between rounded-2xl border border-border bg-card/60 px-4 text-sm font-semibold" data-testid="link-echo-music-studio">
            <span className="flex items-center gap-3"><Music2 className="h-5 w-5 text-primary" /> ECHO Music Studio</span>
            <span className="text-xs text-muted-foreground">{st("Crear canciones ›")}</span>
          </Link>

          <UniverseSelector />
          <Link href="/search" className="mt-3 flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-card/60 p-4 text-sm font-semibold">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" /> {st("Buscar en este universo")}
          </Link>
        </section>

        <Link href="/settings/subscriptions" className="mt-4 flex min-h-14 items-center justify-between rounded-2xl border border-border bg-card/60 px-4 text-sm font-semibold" data-testid="link-my-subscriptions">{st("Mi plan y suscripciones")} <span className="text-xs text-muted-foreground">{st("Ver planes y complementos ›")}</span></Link>

        <section className="mt-9" aria-labelledby="identity-h">
          <h2 id="identity-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Cuentas e identidad activa")}</h2>
          <p className="mt-1.5 px-1 text-[13px] leading-relaxed text-muted-foreground">
            {st('Todo lo que publiques, comentes o envíes saldrá con este perfil.')}
          </p>
          <details className="group mt-3 rounded-2xl border border-border bg-card/40" data-testid="details-account-manager"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden"><span>{st("Cuentas e identidad activa")} · {state.characters.filter(c=>!c.archived).length}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" /></summary><div className="border-t border-border px-3 pb-3"><AccountManager /></div></details>
        </section>

        <section className="mt-9" aria-labelledby="creator-h">
          <h2 id="creator-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Creator y privacidad")}</h2>
          <div className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/60 text-sm font-semibold">
            <Link href="/creator-preview/universes" className="flex min-h-12 items-center px-4 hover:bg-secondary/50">{st("Mis universos y personajes")}</Link>
            <Link href="/creator-preview/privacy" className="flex min-h-12 items-center px-4 hover:bg-secondary/50">{st("Privacidad de personajes")}</Link>
          </div>
        </section>

        <section className="mt-9" aria-labelledby="close-friends-h" data-testid="section-close-friends">
          <h2 id="close-friends-h" className="flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground"><Star className="h-4 w-4 text-primary" /> {st('Mejores amigos · ')}{me.name}</h2>
          <details className="group mt-3 rounded-2xl border border-border bg-card/40" data-testid="details-close-friends"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden"><span>{st('Mejores amigos · ')}{closeFriendContacts.filter(c => (state.closeFriends?.[me.id] ?? []).includes(c.id)).length}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" /></summary><div className="border-t border-border px-3 pb-3">
          <p className="mt-2 px-1 text-xs text-muted-foreground">{st("Solo los personajes seleccionados verán tus próximas historias para mejores amigos. Cada identidad tiene su propia lista.")}</p>
          <div className="mt-3 rounded-2xl border border-border bg-card/60 p-3">
            {closeFriendContacts.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">{language === 'es' ? 'Todavía no hay contactos que se sigan mutuamente con esta cuenta.' : 'No mutual-follow contacts for this account yet.'}</p>}
            {closeFriendContacts.map(c => {
              const selected = (state.closeFriends?.[me.id] ?? []).includes(c.id);
              return <button key={c.id} type="button" aria-pressed={selected} onClick={() => actions.toggleCloseFriend(c.id)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-border/50 px-2 text-left text-sm last:border-0" data-testid={`button-close-friend-${c.id}`}>
                <span className="truncate">{c.name} <span className="text-xs text-muted-foreground">@{c.handle}</span></span>
                <span className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-semibold', selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>{st(selected ? 'Agregado' : 'Agregar')}</span>
              </button>;
            })}
          </div>
          </div></details>
        </section>

        <AppearanceSection />

        <ImageGenerationStyleSection />

        <AutonomySettingsSection />

        <MessageSoundSettings />

        <MusicConnectionsSection />

        <PushNotificationSettings />

        <section className="mt-9" aria-labelledby="support-h">
          <h2 id="support-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Ayuda y seguridad")}</h2>
          <div className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/60 text-sm font-semibold">
            <Link href="/help" className="flex min-h-12 items-center px-4 hover:bg-secondary/50">{st("Centro de ayuda · Reportar un problema")}</Link>
          </div>
        </section>

        <section className="mt-9" aria-labelledby="about-h">
          <h2 id="about-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Sobre ECHO")}</h2>
          <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4 text-[13px] leading-relaxed text-muted-foreground" data-testid="text-prototype-notice">
            <p className="flex gap-2.5"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
              <span>{st("Tu universo, publicaciones, imágenes, comentarios e historias se guardan en tu cuenta privada.")}</span></p>
            <p className="mt-2.5 pl-[26px]">{st("La autonomía de texto puede habilitarse para cuentas autorizadas de la beta privada, con controles individuales y pausa general. La generación de imágenes IA sigue desactivada.")}</p>
            <p className="mt-2.5 pl-[26px]">{st("Las fotos de ejemplo son ilustrativas y no muestran a personas reales.")}</p>
            <p className="mt-2.5 pl-[26px]">{st("Solo tú puedes abrir este universo al iniciar sesión. Puedes cambiar manualmente la identidad activa en esta página.")}</p>
          </div>
        </section>

        <section className="mt-9" aria-labelledby="storage-h">
          <h2 id="storage-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Almacenamiento")}</h2>
          <div className="mt-3 rounded-2xl border border-border p-4 text-[13px]">
            <div className="flex items-center gap-2.5">
              <Cloud className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
              <span className="flex-1">{st("Nube privada ECHO")}</span>
              <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', storageError ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-muted-foreground')} data-testid="status-storage">
                {st(storageError ? 'Pendiente' : 'Sincronizado')}
              </span>
            </div>
            {storageError && <p role="alert" className="mt-3 text-destructive">{storageError}</p>}
            <p className="mt-3 text-muted-foreground">
              {state.posts.length} {st("publicaciones")} · {state.comments.length} {st("comentarios")} · {state.messages.length} {st("mensajes")}
            </p>
            {lastSavedAt && <p className="mt-1.5 text-xs text-muted-foreground">{st("Última sincronización:")} {new Date(lastSavedAt).toLocaleString(({ es: 'es-AR', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', ko: 'ko-KR', ja: 'ja-JP', zh: 'zh-CN' } as const)[language])}</p>}
            {storageError && (
              <button
                type="button"
                onClick={() => void actions.retrySync().then(() => toast({ title: st('Sincronizado') })).catch(() => undefined)}
                className="mt-3 h-10 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
                data-testid="button-retry-sync"
              >
                {st("Reintentar sincronización")}
              </button>
            )}
          </div>
        </section>

        <NelaEasterEgg />
      </div>

    </div>
  );
}

function AppearanceSection() {
  const language = useLanguage();
  const t = useTranslation();
  const st = useSettingsText();
  const { state, actions } = useSocial();
  const current = state.appearance ?? DEFAULT_APPEARANCE;
  const [custom, setCustom] = useState(current.accent);
  const set = (next: Appearance) => {
    try { actions.setAppearance(next); } catch (e) { toast({ title: st('No se pudo aplicar'), description: (e as Error).message }); }
  };
  const themes = [['dark', 'Oscuro', Moon], ['light', 'Claro', Sun], ['system', 'Sistema', Monitor]] as const;
  return (
    <section className="mt-9" aria-labelledby="appearance-h">
      <h2 id="appearance-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Apariencia")}</h2>
      <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1" role="radiogroup" aria-label={st("Tema")}>
          {themes.map(([k, label, Icon]) => (
            <button key={k} type="button" role="radio" aria-checked={current.theme === k} onClick={() => set({ ...current, theme: k })}
              className={cn('flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold', current.theme === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}
              data-testid={`button-theme-${k}`}>
              <Icon className="h-4 w-4" strokeWidth={1.8} /> {st(label)}
            </button>
          ))}
        </div>
        <div className="mt-4 text-xs text-muted-foreground">{st("Color de acento")}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={st("Color de acento")}>
          {ACCENT_PRESETS.map((hex) => {
            const on = current.accent.toLowerCase() === hex;
            return (
              <button key={hex} type="button" role="radio" aria-checked={on} aria-label={`${st("Acento ")}${hex}`} onClick={() => { setCustom(hex); set({ ...current, accent: hex }); }}
                className={cn('grid h-11 w-11 place-items-center rounded-full ring-offset-2 ring-offset-card', on && 'ring-2 ring-foreground/70')} style={{ backgroundColor: hex }}
                data-testid={`button-accent-${hex.slice(1)}`}>
                {on && <Check className="h-4 w-4 text-[#1a1418]" strokeWidth={2.4} />}
              </button>
            );
          })}
          <label className="flex h-11 items-center gap-2 rounded-full border border-border pl-1.5 pr-3 text-xs" data-testid="label-accent-custom">
            <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} onBlur={() => custom !== current.accent && set({ ...current, accent: custom })}
              aria-label={st("Acento personalizado")} className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent p-0" data-testid="input-accent-custom" />
            {st("Personalizado")}
          </label>
          {custom.toLowerCase() !== current.accent.toLowerCase() && (
            <button type="button" onClick={() => set({ ...current, accent: custom })} className="h-11 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground" data-testid="button-accent-apply">{st("Aplicar")}</button>
          )}
        </div>
        <button type="button" onClick={() => { setCustom(DEFAULT_APPEARANCE.accent); set(DEFAULT_APPEARANCE); }} className="mt-4 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="button-appearance-reset">
          {st('Restablecer (oscuro · rosa)')}
        </button>
        <p className="mt-2 text-xs text-muted-foreground">{st("Se sincroniza con tu universo en todos tus dispositivos.")}</p>
        <div className="mt-5 border-t border-border pt-5">
          <label htmlFor="echo-language" className="mb-2 block text-sm font-semibold text-primary">🌐 {t("language")}</label>
          <p className="mb-3 text-xs text-muted-foreground">{t("languageDescription")}</p>
          <div className="relative w-full">
          <select id="echo-language" value={language} onChange={event=>setLanguage(event.target.value as Language)} className="h-11 w-full appearance-none rounded-xl border border-border bg-background pl-3 pr-11 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary" style={{ WebkitAppearance: "none", MozAppearance: "none" }}>
            {LANGUAGES.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>
    </section>
  );
}

function ImageGenerationStyleSection() {
  const st = useSettingsText();
  const { state, actions } = useSocial();
  const selected = state.imageStyle ?? 'natural';
  const styles: { id: ImageStyle; label: string; detail: string }[] = [
    { id: 'natural', label: st('Realismo natural'), detail: st("Fotos cotidianas, piel con textura, luz real y rasgos naturales.") },
    { id: 'phone', label: st('Cámara de celular'), detail: st("Selfies espontáneas, flash, encuadres casuales y ruido digital.") },
    { id: 'analog', label: st('Analógica / 35 mm'), detail: st("Grano de película, colores orgánicos y sensación nostálgica.") },
    { id: 'editorial', label: st('Editorial'), detail: st("Fotografía profesional de moda, iluminación cuidada y detalle realista.") },
    { id: 'cinematic', label: st('Cinematográfica'), detail: st("Sombras, luz dramática y composición de película.") },
  ];
  return <section className="mt-9" aria-labelledby="image-style-h" data-testid="section-ai-image-settings">
    <h2 id="image-style-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Generación de imágenes IA")}</h2>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <h3 className="text-sm font-semibold">{st("Estilo fotográfico predeterminado")}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{st("Elegí cómo querés que se vean las imágenes generadas. Las referencias visuales y rasgos de cada personaje se mantienen independientemente del estilo.")}</p>
      <div className="mt-4 space-y-2" role="radiogroup" aria-label="Estilo de imágenes IA">
        {styles.map(({ id, label, detail }) => <button key={id} type="button" role="radio" aria-checked={selected === id}
          onClick={() => { actions.setImageStyle(id); toast({ title: st('Estilo de imagen guardado'), description: label }); }}
          data-testid={`button-image-style-${id}`}
          className={cn('flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors', selected === id ? 'border-primary bg-primary/10' : 'border-border bg-background/30')}>
          <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border', selected === id ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50')}>
            {selected === id && <Check className="h-3 w-3" />}
          </span>
          <span><span className="block text-sm font-semibold">{label}{id === 'natural' && <span className="ml-1 text-[11px] font-normal text-muted-foreground">· {st("recomendado")}</span>}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{detail}</span></span>
        </button>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{st("La preferencia se sincroniza con este universo. Se aplicará al generador cuando esté conectado; elegir un estilo no genera imágenes ni consume créditos.")}</p>
    </div>
  </section>;
}
