import { BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Character } from '@/domain/types';

export function VerifiedBadge({ account, className }: { account?: Pick<Character, 'id' | 'verified'> | null; className?: string }) {
  if (!account?.verified) return null;
  return (
    <BadgeCheck
      role="img"
      aria-label="Cuenta verificada"
      className={cn('inline h-[15px] w-[15px] shrink-0 fill-primary text-primary-foreground', className)}
      strokeWidth={2.2}
      data-testid={`badge-verified-${account.id}`}
    />
  );
}
