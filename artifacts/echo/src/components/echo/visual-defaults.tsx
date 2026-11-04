import React from 'react';
import { characterInitials } from '../../lib/visual-defaults';

export const UNIVERSE_COVER_BG = '#412c40';
export const CHARACTER_INITIALS_BG = '#62435b';
const SERIF = "'Instrument Serif', Georgia, serif";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export interface UniverseCoverProps {
  name: string;
  imageSrc?: string | null;
  className?: string;
}

export function UniverseCover({ name, imageSrc, className }: UniverseCoverProps) {
  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={name}
        draggable={false}
        loading="lazy"
        className={cx('block h-full w-full object-cover', className)}
        data-testid="img-universe-cover"
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={name.trim() || 'Universo sin nombre'}
      className={cx('flex w-full items-center justify-center p-4 text-center', className)}
      style={{ background: UNIVERSE_COVER_BG, aspectRatio: '16 / 10', minHeight: 128 }}
      data-testid="universe-cover-fallback"
    >
      <span
        aria-hidden="true"
        style={{
          fontFamily: SERIF,
          color: '#f3e4ec',
          fontSize: 'clamp(20px, 6cqw, 34px)',
          lineHeight: 1.05,
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          hyphens: 'auto',
          maxWidth: '100%',
        }}
      >
        {name.trim() || 'Universo sin nombre'}
      </span>
    </div>
  );
}

export interface CharacterInitialsProps {
  name: string;
  size?: number;
  className?: string;
  testId?: string;
}

export function CharacterInitials({ name, size = 36, className, testId }: CharacterInitialsProps) {
  const initials = characterInitials(name);
  return (
    <svg
      role="img"
      aria-label={name.trim() || 'Personaje sin nombre'}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={cx('inline-block shrink-0', className)}
      data-testid={testId}
    >
      <title>{name.trim() || 'Personaje sin nombre'}</title>
      <circle cx="50" cy="50" r="50" fill={CHARACTER_INITIALS_BG} />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fbf1f6"
        fontFamily={SERIF}
        fontSize={initials.length > 2 ? 32 : 42}
        aria-hidden="true"
      >
        {initials}
      </text>
    </svg>
  );
}
