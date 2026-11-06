import { LANGUAGES, setLanguage, useLanguage, type Language } from '@/lib/i18n';

export function PublicLanguageSelector() {
  const language = useLanguage();
  return (
    <label className="inline-flex items-center gap-2 text-sm text-muted-foreground" data-testid="public-language-selector">
      <span aria-hidden="true">🌐</span>
      <span className="sr-only">Language / Idioma</span>
      <select
        aria-label="Language / Idioma"
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
        className="max-w-32 rounded-lg border border-white/20 bg-[#201f22] px-2 py-2 text-[#f2ece8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#df9fb1]"
      >
        {LANGUAGES.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
      </select>
    </label>
  );
}
