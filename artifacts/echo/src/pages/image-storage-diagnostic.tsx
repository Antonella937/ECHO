import { useAuth, useUser } from '@clerk/react';
import { useState } from 'react';
import { Link } from 'wouter';
import { TopBar, useBack } from '@/components/echo/top-bar';

type Result = { status: string; uploaded?: boolean; readBack?: boolean; storageDeleted?: boolean; recordDeleted?: boolean; error?: string };

export default function ImageStorageDiagnosticPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const back = useBack();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  // The backend independently checks the authenticated user's allowlist.
  const allowed = user?.id === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' || user?.id === 'user_3LfRV9oK9WP655tpVF3kavfwgtx';
  async function run() {
    setBusy(true); setResult(null); setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('No se pudo obtener tu sesión.');
      const origin = import.meta.env.VITE_ECHO_API_ORIGIN?.trim()?.replace(/\/$/, '') || '';
      const response = await fetch(`${origin}/api/ai-engine/images/storage-self-test`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await response.json() as Result;
      setResult(data);
      if (!response.ok) setError(response.status === 404 ? 'Diagnóstico no disponible: verificá que esté activado en Render y que tu cuenta tenga acceso.' : 'La prueba no pasó. Revisá los logs del backend antes de volver a intentarlo.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la prueba.'); }
    finally { setBusy(false); }
  }
  if (!allowed) return null;
  return <div>
    <TopBar title="Diagnóstico de imágenes" onBack={back} />
    <div className="px-4 pt-5 space-y-4">
      <p className="text-sm text-muted-foreground">Prueba privada de Supabase y Neon con una imagen sintética de 1 píxel. No llama a fal.ai ni consume créditos.</p>
      <button type="button" disabled={busy} onClick={() => void run()} className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Comprobando…' : 'Probar almacenamiento'}</button>
      {result && <div className="rounded-xl border border-border p-4 text-sm space-y-2" role="status">
        <p className="font-semibold">{result.status === 'passed' ? 'Prueba completada correctamente' : 'Prueba incompleta'}</p>
        {([['Subida', result.uploaded], ['Lectura', result.readBack], ['Borrado en Supabase', result.storageDeleted], ['Borrado en Neon', result.recordDeleted]] as const).map(([label, ok]) => <p key={label}>{ok ? '✓' : '✕'} {label}</p>)}
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Link href="/settings" className="block text-sm underline">Volver a ajustes</Link>
    </div>
  </div>;
}
