import { useState, type FormEvent } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Image as ImageIcon, LoaderCircle, Sparkles, Type } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Link } from 'wouter';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import './public-surface.css';
import { useOnboardingText } from '@/lib/onboarding-translations';
import { useLanguage } from '@/lib/i18n';
import { useMemo } from 'react';
const validationCopy: Record<string,Record<string,string>> = {"es":{"Escribe al menos 2 caracteres.":"Escribe al menos 2 caracteres.","Usa 60 caracteres o menos.":"Usa 60 caracteres o menos.","Escribe el nombre visible.":"Escribe el nombre visible.","El usuario necesita al menos 3 caracteres.":"El usuario necesita al menos 3 caracteres.","Usa 30 caracteres o menos.":"Usa 30 caracteres o menos.","Usa letras, números, puntos o guiones bajos.":"Usa letras, números, puntos o guiones bajos.","La biografía puede tener hasta 160 caracteres.":"La biografía puede tener hasta 160 caracteres."},"en":{"Escribe al menos 2 caracteres.":"At least 2 characters required.","Usa 60 caracteres o menos.":"Use 60 characters or fewer.","Escribe el nombre visible.":"Enter a display name.","El usuario necesita al menos 3 caracteres.":"Username must have at least 3 characters.","Usa 30 caracteres o menos.":"Use 30 characters or fewer.","Usa letras, números, puntos o guiones bajos.":"Use letters, numbers, dots or underscores.","La biografía puede tener hasta 160 caracteres.":"Bio must be 160 characters or fewer."},"pt":{"Escribe al menos 2 caracteres.":"Digite pelo menos 2 caracteres.","Usa 60 caracteres o menos.":"Use no máximo 60 caracteres.","Escribe el nombre visible.":"Digite um nome de exibição.","El usuario necesita al menos 3 caracteres.":"O nome de usuário precisa de pelo menos 3 caracteres.","Usa 30 caracteres o menos.":"Use no máximo 30 caracteres.","Usa letras, números, puntos o guiones bajos.":"Use letras, números, pontos ou sublinhados.","La biografía puede tener hasta 160 caracteres.":"A biografia deve ter no máximo 160 caracteres."},"fr":{"Escribe al menos 2 caracteres.":"Saisissez au moins 2 caractères.","Usa 60 caracteres o menos.":"Utilisez 60 caractères maximum.","Escribe el nombre visible.":"Saisissez un nom affiché.","El usuario necesita al menos 3 caracteres.":"Le nom d’utilisateur doit comporter au moins 3 caractères.","Usa 30 caracteres o menos.":"Utilisez 30 caractères maximum.","Usa letras, números, puntos o guiones bajos.":"Utilisez des lettres, chiffres, points ou traits de soulignement.","La biografía puede tener hasta 160 caracteres.":"La biographie doit contenir 160 caractères maximum."},"de":{"Escribe al menos 2 caracteres.":"Mindestens 2 Zeichen eingeben.","Usa 60 caracteres o menos.":"Maximal 60 Zeichen verwenden.","Escribe el nombre visible.":"Anzeigenamen eingeben.","El usuario necesita al menos 3 caracteres.":"Der Benutzername benötigt mindestens 3 Zeichen.","Usa 30 caracteres o menos.":"Maximal 30 Zeichen verwenden.","Usa letras, números, puntos o guiones bajos.":"Buchstaben, Zahlen, Punkte oder Unterstriche verwenden.","La biografía puede tener hasta 160 caracteres.":"Die Biografie darf höchstens 160 Zeichen enthalten."},"it":{"Escribe al menos 2 caracteres.":"Inserisci almeno 2 caratteri.","Usa 60 caracteres o menos.":"Usa al massimo 60 caratteri.","Escribe el nombre visible.":"Inserisci un nome visualizzato.","El usuario necesita al menos 3 caracteres.":"Il nome utente deve contenere almeno 3 caratteri.","Usa 30 caracteres o menos.":"Usa al massimo 30 caratteri.","Usa letras, números, puntos o guiones bajos.":"Usa lettere, numeri, punti o trattini bassi.","La biografía puede tener hasta 160 caracteres.":"La biografia può contenere al massimo 160 caratteri."},"ko":{"Escribe al menos 2 caracteres.":"최소 2자 이상 입력하세요.","Usa 60 caracteres o menos.":"60자 이하로 입력하세요.","Escribe el nombre visible.":"표시 이름을 입력하세요.","El usuario necesita al menos 3 caracteres.":"사용자 이름은 최소 3자 이상이어야 합니다.","Usa 30 caracteres o menos.":"30자 이하로 입력하세요.","Usa letras, números, puntos o guiones bajos.":"영문자, 숫자, 마침표 또는 밑줄을 사용하세요.","La biografía puede tener hasta 160 caracteres.":"소개는 160자 이하로 입력하세요."},"ja":{"Escribe al menos 2 caracteres.":"2文字以上入力してください。","Usa 60 caracteres o menos.":"60文字以内で入力してください。","Escribe el nombre visible.":"表示名を入力してください。","El usuario necesita al menos 3 caracteres.":"ユーザー名は3文字以上必要です。","Usa 30 caracteres o menos.":"30文字以内で入力してください。","Usa letras, números, puntos o guiones bajos.":"英数字、ピリオド、アンダースコアを使用してください。","La biografía puede tener hasta 160 caracteres.":"自己紹介は160文字以内で入力してください。"},"zh":{"Escribe al menos 2 caracteres.":"请至少输入2个字符。","Usa 60 caracteres o menos.":"请使用不超过60个字符。","Escribe el nombre visible.":"请输入显示名称。","El usuario necesita al menos 3 caracteres.":"用户名至少需要3个字符。","Usa 30 caracteres o menos.":"请使用不超过30个字符。","Usa letras, números, puntos o guiones bajos.":"请使用字母、数字、句点或下划线。","La biografía puede tener hasta 160 caracteres.":"简介不能超过160个字符。"}};


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

const createOnboardingSchema = (t: (key: string) => string) => z.object({
  plan: z.enum(['free', 'creator']),
  universeName: z.string().trim().min(2, t("Escribe al menos 2 caracteres.")).max(60, t("Usa 60 caracteres o menos.")),
  displayName: z.string().trim().min(1, t("Escribe el nombre visible.")).max(60, t("Usa 60 caracteres o menos.")),
  username: z.string().trim().min(3, t("El usuario necesita al menos 3 caracteres.")).max(30, t("Usa 30 caracteres o menos."))
    .regex(/^[a-zA-Z0-9._]+$/, t("Usa letras, números, puntos o guiones bajos.")),
  bio: z.string().trim().max(160, t("La biografía puede tener hasta 160 caracteres.")),
});

type OnboardingValues = z.infer<ReturnType<typeof createOnboardingSchema>>;

export default function OnboardingPage({ saving, error, onComplete, onEnter }: OnboardingPageProps) {
  const t = useOnboardingText();
  const language = useLanguage();
  const validationText = (key: string) => validationCopy[language]?.[key] ?? validationCopy.en[key] ?? key;
  const onboardingSchema = useMemo(() => createOnboardingSchema(validationText), [language]);
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
      setSubmitError(cause instanceof Error ? cause.message : t('No se pudo guardar. Inténtalo de nuevo.'));
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
            <p>{t('Tu universo')} <strong>{form.getValues('universeName')}</strong> {t("y el perfil de")} <strong>{form.getValues('displayName')}</strong> {t("están preparados. Lo que ocurra después, lo decides tú.")}</p>
            <button type="button" className="ep-button" onClick={onEnter} data-testid="button-enter-echo">{t("Entrar a ECHO")} <ArrowRight size={16} /></button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="echo-public ep-onboarding">
      <header className="ep-onboarding-nav">
        <Link href="/" className="ep-brand" aria-label="ECHO, inicio" data-testid="link-onboarding-brand"><span className="ep-mark">e</span><span>ECHO</span></Link>
        <Link href="/faq" className="ep-text-link" data-testid="link-onboarding-help"><CircleHelp size={15} /> {t("Ayuda")}</Link>
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
                  <p className="ep-step-caption">{t("Será el lugar privado donde empieza tu mundo. Puedes afinarlo más adelante.")}</p>
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
                  <p className="ep-step-caption">{t("Una identidad inicial, lista para que la sigas desarrollando.")}</p>
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
                      <span className="ep-field-hint">{t("Se guardará sin @. Letras, números, puntos o guiones bajos.")}</span>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="bio" render={({ field }) => (
                    <FormItem className="ep-field">
                      <FormLabel className="ep-field-label">{t("Biografía")} <span className="ep-muted">{t("(opcional)")}</span></FormLabel>
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
                  {saving ? <><LoaderCircle size={15} className="ep-saving-mark" /> {t("Guardando…")}</> : <>{t(step === 2 ? 'Crear mi universo' : 'Continuar')} <ArrowRight size={15} /></>}
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
