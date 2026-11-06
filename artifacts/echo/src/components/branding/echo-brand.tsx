import React, { useId, useState } from 'react';
import { useLanguage } from '@/lib/i18n';

/** Decorative glyphs never replace the accessible status label. No timers or data access. */
export function EchoLoader({ size = 56, decorative = false }: { size?: number; decorative?: boolean }) {
  return (
    <span className="echo-loader" role={decorative ? undefined : 'status'}
      aria-label={decorative ? undefined : 'Cargando ECHO'} aria-busy={decorative ? undefined : true}>
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        <circle cx="100" cy="100" r="63" fill="#30233d" />
        <g className="echo-loader-arcs" fill="none" stroke="#95809f" strokeWidth="1">
          <circle cx="100" cy="100" r="79" opacity=".4" strokeDasharray="165 65 90 176" />
          <circle cx="100" cy="100" r="92" opacity=".23" strokeDasharray="220 75 105 178" />
          <circle cx="100" cy="8" r="2" fill="#b4a0bf" stroke="none" />
          <circle cx="192" cy="100" r="2" fill="#b4a0bf" stroke="none" />
          <circle cx="21" cy="100" r="1.7" fill="#b4a0bf" stroke="none" />
        </g>
        <text x="100" y="93" dominantBaseline="central" textAnchor="middle" fontSize="76"
          fontFamily="'Instrument Serif', Georgia, serif" fill="#e5c5f6">e</text>
      </svg>
    </span>
  );
}

/** Shown only while the existing authentication state is unresolved. Never holds navigation. */
export function EchoSplash() {
  return (
    <div className="echo-splash" role="status" aria-label="Cargando ECHO" aria-busy="true">
      <div className="echo-splash-content">
        <div className="echo-splash-wordmark" aria-hidden="true">ECHO</div>
        <div className="echo-splash-rule" aria-hidden="true" />
        <p className="echo-splash-tagline">EVERY WORLD HAS A STORY</p>
        <EchoLoader size={88} decorative />
      </div>
    </div>
  );
}

export function CreatorSignature({ variant }: { variant: 'created' | 'script' }) {
  return <small className={`echo-signature echo-signature-${variant}`}>
    {variant === 'created' ? 'CREATED BY NELA' : 'nela.'}
  </small>;
}

/** Ephemeral credits only: no session fields, persistence, navigation or network requests. */
export function NelaEasterEgg() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const language = useLanguage();
  const messages: Record<string, string> = {
    es: 'ECHO nació de una idea pequeña y de las ganas enormes de crear mundos donde cada historia encuentre su lugar. Gracias por ser parte de este universo. ♡',
    en: 'ECHO began with a small idea and a big dream: to create worlds where every story has a place. Thank you for being part of this universe. ♡',
    pt: 'ECHO nasceu de uma pequena ideia e de um grande sonho: criar mundos onde cada história tenha seu lugar. Obrigada por fazer parte deste universo. ♡',
    fr: 'ECHO est né d’une petite idée et d’un grand rêve : créer des mondes où chaque histoire trouve sa place. Merci de faire partie de cet univers. ♡',
    de: 'ECHO entstand aus einer kleinen Idee und einem großen Traum: Welten zu erschaffen, in denen jede Geschichte ihren Platz findet. Danke, dass du Teil dieses Universums bist. ♡',
    it: 'ECHO è nato da una piccola idea e da un grande sogno: creare mondi in cui ogni storia trovi il suo posto. Grazie per far parte di questo universo. ♡',
    ko: 'ECHO는 작은 아이디어와 큰 꿈에서 시작됐어요. 모든 이야기가 자신만의 자리를 찾을 수 있는 세상을 만들고 싶었죠. 이 우주의 일부가 되어 줘서 고마워요. ♡',
    ja: 'ECHOは、小さなアイデアと大きな夢から生まれました。すべての物語が居場所を見つけられる世界を作りたかったのです。この宇宙の一員になってくれてありがとう。♡',
    zh: 'ECHO 始于一个小小的想法和一个大大的梦想：创造让每个故事都有归属的世界。谢谢你成为这个宇宙的一部分。♡',
  };
  const labels: Record<string, string> = { es: 'Descubrir el origen de ECHO', en: 'Discover the origin of ECHO', pt: 'Descubra a origem do ECHO', fr: 'Découvrir l’origine d’ECHO', de: 'Entdecke den Ursprung von ECHO', it: 'Scopri le origini di ECHO', ko: 'ECHO의 시작 알아보기', ja: 'ECHOのはじまりを見る', zh: '探索 ECHO 的起源' };
  return (
    <div className="echo-nela-egg">
      <button type="button" className="echo-nela-trigger" aria-label={labels[language] ?? labels.es}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}
        data-testid="button-nela-credits">N</button>
      <div id={id} hidden={!open} className="echo-nela-response" role="status">
        <p>{messages[language] ?? messages.es}</p>
        <CreatorSignature variant="script" />
      </div>
    </div>
  );
}
