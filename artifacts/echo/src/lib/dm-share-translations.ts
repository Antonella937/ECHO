import type { Language } from './i18n';

/** Text inserted into a DM when a post is shared. Existing sent messages stay unchanged. */
const prompts: Record<Language, string> = {
  es: 'Mirá esto',
  en: 'Check this out',
  pt: 'Olha isso',
  fr: 'Regarde ça',
  de: 'Schau dir das an',
  it: 'Guarda questo',
  ko: '이거 봐',
  ja: 'これ見て',
  zh: '看看这个',
};

export function dmSharePrompt(language: Language): string {
  return prompts[language] ?? prompts.es;
}
