import { useRef, type ReactNode, type RefObject } from 'react';
import { Bold, Italic, Underline } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

type Editable = HTMLTextAreaElement | HTMLInputElement;
type Style = 'bold' | 'italic' | 'boldItalic' | 'underline';

const labels: Record<string, [string,string,string,string]> = {
  es:['Negrita','Cursiva','Negrita y cursiva','Subrayado'],
  en:['Bold','Italic','Bold and italic','Underline'],
  pt:['Negrito','Itálico','Negrito e itálico','Sublinhado'],
  fr:['Gras','Italique','Gras et italique','Souligné'],
  de:['Fett','Kursiv','Fett und kursiv','Unterstrichen'],
  it:['Grassetto','Corsivo','Grassetto e corsivo','Sottolineato'],
  ko:['굵게','기울임꼴','굵게 및 기울임꼴','밑줄'],
  ja:['太字','斜体','太字と斜体','下線'],
  zh:['粗体','斜体','粗斜体','下划线'],
};

/** Keeps selection when a toolbar button is tapped (including mobile browsers). */
export function FormattingToolbar({ inputRef, value, onChange, maxLength, className = '' }: {
  inputRef: RefObject<Editable | null>;
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  className?: string;
}) {
  const language = useLanguage();
  const selected = useRef<{ start:number; end:number } | null>(null);
  const names = labels[language] ?? labels.en;
  const buttons: { style:Style; name:string; marker:string; icon:ReactNode }[] = [
    {style:'bold',name:names[0],marker:'**',icon:<Bold size={15}/>},
    {style:'italic',name:names[1],marker:'*',icon:<Italic size={15}/>},
    {style:'boldItalic',name:names[2],marker:'***',icon:<span className="text-xs font-bold italic">BI</span>},
    {style:'underline',name:names[3],marker:'__',icon:<Underline size={15}/>},
  ];
  const wrap = (marker:string) => {
    const input = inputRef.current;
    if (!input) return;
    const selection = selected.current;
    const start = document.activeElement === input ? input.selectionStart ?? value.length : selection?.start ?? value.length;
    const end = document.activeElement === input ? input.selectionEnd ?? start : selection?.end ?? start;
    const a = Math.min(start,end), b = Math.max(start,end);
    const chosen = value.slice(a,b);
    const replacement = marker + chosen + marker;
    const next = value.slice(0,a) + replacement + value.slice(b);
    if (maxLength && next.length > maxLength) return;
    onChange(next);
    requestAnimationFrame(() => {
      input.focus();
      const from = a + marker.length;
      input.setSelectionRange(from, from + chosen.length);
      selected.current = {start:from,end:from+chosen.length};
    });
  };
  return <div className={`flex items-center gap-1 ${className}`} role="toolbar" aria-label={language === 'es' ? 'Formato de texto' : 'Text formatting'}>
    {buttons.map(({style,name,marker,icon}) => <button key={style} type="button" title={name} aria-label={name}
      onPointerDown={() => { const input=inputRef.current; if(input) selected.current={start:input.selectionStart,end:input.selectionEnd}; }}
      onMouseDown={e => e.preventDefault()}
      onClick={() => wrap(marker)}
      className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-border/70 bg-secondary/50 px-2 text-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      data-testid={`format-${style}`}>{icon}</button>)}
  </div>;
}
