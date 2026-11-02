import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-8 text-center">
      <span className="wordmark text-[40px] text-foreground/20">ECHO</span>
      <p className="mt-6 font-display text-xl font-light">Aquí no resuena nada</p>
      <p className="mt-2 text-sm text-muted-foreground">Esta página no existe.</p>
      <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-full bg-secondary px-6 text-sm font-semibold" data-testid="link-404-home">
        Volver al inicio
      </Link>
    </div>
  );
}
