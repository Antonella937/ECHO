import { useEffect, useState } from 'react';
import { useSocial } from '@/store/social-store';
import type { Appearance } from '@/domain/types';

export const DEFAULT_APPEARANCE: Appearance = { theme: 'dark', accent: '#df9fb1' };
export const ACCENT_PRESETS = ['#df9fb1', '#e6a57e', '#d9c27a', '#9fcbb0', '#8fb8de', '#b5a3e0', '#e07a8a'];

export function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function prefersDark() {
  return typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function luminance(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

/** Applies appearance via tokens only (class + CSS variables). Layout and type are untouched. */
export function AppearanceSync() {
  const { state } = useSocial();
  const { theme, accent } = state.appearance ?? DEFAULT_APPEARANCE;
  const [systemDark, setSystemDark] = useState(prefersDark);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.classList.toggle('theme-light', !dark);
    const [h, s, l] = hexToHsl(/^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_APPEARANCE.accent);
    // Keep contrast: in light mode darken the accent; in dark mode keep it luminous.
    let pl = dark ? Math.max(l, 62) : Math.min(l, 46);
    // Accent is also small link text: enforce readable contrast for arbitrary hues.
    while (pl > 15 && pl < 90 && (dark
      ? (luminance(h, s, pl) + 0.05) / 0.055 < 4.5
      : 1.01 / (luminance(h, s, pl) + 0.05) < 4.5)) pl += dark ? 1 : -1;
    const primary = `${h} ${s}% ${pl}%`;
    const fg = luminance(h, s, pl) > 0.179 ? '240 6% 7%' : '30 30% 98%';
    const vars: Record<string, string> = {
      '--dark-surface-primary': `${h} ${s}% ${Math.max(l, 76)}%`,
      '--primary': primary, '--ring': primary, '--sidebar-primary': primary, '--sidebar-ring': primary, '--chart-1': primary,
      '--primary-foreground': fg, '--sidebar-primary-foreground': fg,
      '--accent': dark ? `${h} ${Math.min(s, 30)}% 16%` : `${h} ${Math.min(s, 55)}% 93%`,
      '--accent-foreground': dark ? `${h} ${Math.min(s, 60)}% 84%` : `${h} ${Math.min(s, 50)}% 30%`,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b0d' : '#f9f6f3');
  }, [dark, accent]);
  return null;
}
