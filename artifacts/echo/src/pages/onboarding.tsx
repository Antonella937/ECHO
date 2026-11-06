import { useState, type FormEvent } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Image as ImageIcon, LoaderCircle, Sparkles, Type } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Link } from 'wouter';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import './public-surface.css';
import { useOnboardingText } from '@/lib/onboarding-translations';

export type CreatorPlan = 'free' | 'creator';

export interface CreatorOnboardingInput {
  plan: CreatorPlan;
  universeName: string;
  displayName: string;
  /** Username is submitted without the leading @. */
  username: string;
  bio: string;
}

export interface OnboardingPageProps {
  saving: boolean;
  error: string | null;
  onComplete: (input: CreatorOnboardingInput) => Promise<void>;
  onEnter: () => void;
}

const onboardingSchema = z.object({
  plan: z.enum(['free', 'creator']),
  universeName: z.string().trim().min(2, 'Escribe al menos 2 caracteres.').max(60, 'Usa 60 caracteres o menos.'),
  displayName: z.string().trim().min(1, 'Escribe el nombre visible.').max(60, 'Usa 60 caracteres o menos.'),
  username: z.string().trim().min(3, 'El usuario necesita al menos 3 caracteres.').max(30, 'Usa 30 caracteres o menos.')
    .regex(/^[a-zA-Z0-9._]+$/, 'Usa letras, números, puntos o guiones bajos.'),
  bio: z.string().trim().max(160, 'La biografía puede tener hasta 160 caracteres.'),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

export default function OnboardingPage({ saving, error, onComplete, onEnter }: OnboardingPageProps) {
  const t = useOnboardingText();
  const [step, setStep] = useState(0);
  const [complete, setComplete] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { plan: 'free', universeName: '', displayName: '', username: '', bio: '' },
    mode: 'onTouched',
  });
  const selectedPlan = form.watch('plan');

  const advance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    const fields: (keyof OnboardingValues)[] = step === 0
      ? ['plan']
      : step === 1
        ? ['universeName']
        : ['displayName', 'username', 'bio'];
    const valid = await form.trigger(fields, { shouldFocus: true });
    if (!valid) return;
    if (step < 2) {
      setStep((current) => current + 1);
      return;
    }
    const values = form.getValues();
    const input: CreatorOnboardingInput = {
      ...values,
      username: values.username.trim().replace(/^@+/, '').toLowerCase(),
      universeName: values.universeName.trim(),
      displayName: values.displayName.trim(),
      bio: values.bio.trim(),
    };
    try {
      await onComplete(input);
      setComplete(true);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'No se pudo guardar. Inténtalo de nuevo.');
    }
  };

  const goBack = () => {
    setSubmitError(null);
    setStep((current) => Math.max(0, current - 1));
  };

  if (complete) {
    return (
      <main className="echo-public ep-onboarding">
        <header className="ep-onboarding-nav">
          <Link href="/" className="ep-brand" aria-label="ECHO" data-testid="link-onboarding-brand"><span className="ep-mark">e</span><span>ECHO</span></Link>
          <span className="ep-eyebrow">{t("Tu espacio está listo")}</span>
        </header>
        <section className="ep-onboarding-main">
          <div className="ep-complete" role="status" data-testid="status-onboarding-complete">
            <span className="ep-complete-icon"><Check size={24} /></span>
            <span className="ep-eyebrow">{t("Bienvenido a ECHO")}</span>
            <h1>{t("Ya puedes entrar.")}</h1>
            <p>{t('Tu universo')} <strong>{form.getValues('universeName')}</strong> y el perfil de <strong>{form.getValues('displayName')}</strong> están preparados. Lo que ocurra después, lo decides tú.</p>
            <button type="button" className="ep-button" onClick={onEnter} data-testid="button-enter-echo">Entrar a ECHO <ArrowRight size={16} /></button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="echo-public ep-onboarding">
      <header className="ep-onboarding-nav">
        <Link href="/" className="ep-brand" aria-label="ECHO, inicio" data-testid="link-onboarding-brand"><span className="ep-mark">e</span><span>ECHO</span></Link>
        <Link href="/faq" className="ep-text-link" data-testid="link-onboarding-help"><CircleHelp size={15} /> Ayuda</Link>
      </header>
      <section className="ep-onboarding-main">
        <div className="ep-onboarding-heading">
          <span className="ep-eyebrow">{t("ECHO Creator · bienvenida")}</span>
          <h1>{t("Hagamos espacio para tu mundo.")}</h1>
          <p>{t("Tres pasos breves. Tu cuenta ya está lista.")}</p>
        </div>
        <div className="ep-progress" aria-label={`${t('Paso')} ${step + 1} ${t('de')} 3`}>
          {[0, 1, 2].map((item) => <span key={item} className={item <= step ? 'active' : ''} />)}
        </div>
        <div className="ep-onboarding-panel">
          <Form {...form}>
            <form onSubmit={advance} noValidate>
              {step === 0 && (
                <section aria-labelledby="step-plan-heading">
                  <h2 className="ep-step-title" id="step-plan-heading">{t("Elige cómo empezar")}</h2>
                  <p className="ep-step-caption">{t("No hay cobros activos. Puedes elegir la opción que mejor describe tu intención.")}</p>
                  <FormField control={form.control} name="plan" render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="ep-plan-options" role="radiogroup" aria-label="Selecciona un plan">
                          <button type="button" role="radio" aria-checked={field.value === 'free'} className={`ep-plan ${field.value === 'free' ? 'selected' : ''}`} onClick={() => field.onChange('free')} data-testid="button-plan-free">
                            <div className="ep-plan-top"><Type size={17} /><span>{field.value === 'free' && <Check size={16} />}</span></div>
                            <h3>Free</h3><p>{t("Texto e imágenes con límites diarios.")}</p>
                          </button>
                          <button type="button" role="radio" aria-checked={field.value === 'creator'} className={`ep-plan ${field.value === 'creator' ? 'selected' : ''}`} onClick={() => field.onChange('creator')} data-testid="button-plan-creator">
                            <div className="ep-plan-top"><Sparkles size={17} /><span>{field.value === 'creator' && <Check size={16} />}</span></div>
                            <h3>Creator</h3><p>{t("Selección beta preparada. Sin cobro activo.")}</p>
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <p className="ep-field-hint"><ImageIcon size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />{t("Voz, video y música están fuera de beta por ahora.")}</p>
                </section>
              )}
              {step === 1 && (
                <section aria-labelledby="step-universe-heading">
                  <h2 className="ep-step-title" id="step-universe-heading">{t("Ponle nombre a tu universo")}</h2>
                  <p className="ep-step-caption">Será el lugar privado donde empieza tu mundo. Puedes afinarlo más adelante.</p>
                  <FormField control={form.control} name="universeName" render={({ field }) => (
                    <FormItem className="ep-field">
                      <FormLabel className="ep-field-label">{t("Nombre del universo")}</FormLabel>
                      <FormControl><input {...field} className="ep-field-control" placeholder={t("Por ejemplo, La habitación azul")} autoComplete="off" maxLength={60} data-testid="input-universe-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <p className="ep-field-hint">{t("Entre 2 y 60 caracteres.")}</p>
                </section>
              )}
              {step === 2 && (
                <section aria-labelledby="step-character-heading">
                  <h2 className="ep-step-title" id="step-character-heading">{t("Crea tu primer personaje")}</h2>
                  <p className="ep-step-caption">Una identidad inicial, lista para que la sigas desarrollando.</p>
                  <FormField control={form.control} name="displayName" render={({ field }) => (
                    <FormItem className="ep-field">
                      <FormLabel className="ep-field-label">{t("Nombre visible")}</FormLabel>
                      <FormControl><input {...field} className="ep-field-control" placeholder={t("¿Cómo se llama?")} autoComplete="off" maxLength={60} data-testid="input-display-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="username" render={({ field }) => (
                    <FormItem className="ep-field">
                      <FormLabel className="ep-field-label">{t("Usuario")}</FormLabel>
                      <FormControl><div style={{ display: 'flex', alignItems: 'center', background: '#141216', border: '1px solid rgba(239,220,232,.16)', borderRadius: 14, paddingLeft: 14 }}>
                        <span aria-hidden="true" style={{ color: 'var(--ep-rose)' }}>@</span>
                        <input {...field} className="ep-field-control" style={{ border: 0, background: 'transparent' }} placeholder="nombre.de.usuario" autoComplete="off" maxLength={30} data-testid="input-username" />
                      </div></FormControl>
                      <span className="ep-field-hint">Se guardará sin @. Letras, números, puntos o guiones bajos.</span>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="bio" render={({ field }) => (
                    <FormItem className="ep-field">
                      <FormLabel className="ep-field-label">Biografía <span className="ep-muted">{t("(opcional)")}</span></FormLabel>
                      <FormControl><textarea {...field} className="ep-field-control" placeholder={t("Una pequeña pista sobre su mundo…")} maxLength={160} data-testid="input-bio" /></FormControl>
                      <span className="ep-field-hint">{field.value.length}/160</span>
                      <FormMessage />
                    </FormItem>
                  )} />
                </section>
              )}
              {(error || submitError) && <p className="ep-form-error" role="alert" data-testid="status-onboarding-error">{submitError || error}</p>}
              <div className="ep-step-actions">
                {step > 0
                  ? <button type="button" className="ep-step-back" onClick={goBack} disabled={saving} data-testid="button-onboarding-back"><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{t("Volver")}</button>
                  : <span className="ep-field-hint">{t('Paso')} {step + 1} {t('de')} 3</span>}
                <button type="submit" className="ep-button" disabled={saving} data-testid="button-onboarding-continue">
                  {saving ? <><LoaderCircle size={15} className="ep-saving-mark" /> Guardando…</> : <>{t(step === 2 ? 'Crear mi universo' : 'Continuar')} <ArrowRight size={15} /></>}
                </button>
              </div>
            </form>
          </Form>
        </div>
      </section>
      <footer className="ep-footer" style={{ marginTop: 'auto', borderTop: 0, paddingBottom: 0 }}>
        <div className="ep-footer-inner" style={{ justifyContent: 'center' }}><span>{t("Un espacio privado, bajo tu control.")}</span></div>
      </footer>
    </main>
  );
}
