import { useAuth, useUser } from '@clerk/react';
import { useState } from 'react';
import { Link } from 'wouter';
import { TopBar, useBack } from '@/components/echo/top-bar';

type LegacyEntry = { path: string; createdAt: string | null };
type LegacyStatus = 'available' | 'missing' | 'unknown' | 'not_owned';
type LegacyCheck = { path: string; status: LegacyStatus };
type LegacyUsage = { universe_id: string; posts: number; stories: number; characters: number; legacy_posts: boolean; legacy_stories: boolean; legacy_characters: boolean };

type Result = { status: string; uploaded?: boolean; readBack?: boolean; storageDeleted?: boolean; recordDeleted?: boolean; error?: string };

export default function ImageStorageDiagnosticPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const back = useBack();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [legacyProgress, setLegacyProgress] = useState({ checked: 0, total: 0 });
  const [legacyResults, setLegacyResults] = useState<LegacyCheck[]>([]);
  const [legacyUsage, setLegacyUsage] = useState<LegacyUsage[]>([]);
  const [legacyError, setLegacyError] = useState('');
  const [legacyComplete, setLegacyComplete] = useState(false);
  async function checkLegacy() {
    setLegacyBusy(true);
    setLegacyResults([]);
    setLegacyUsage([]);
    setLegacyProgress({ checked: 0, total: 0 });
    setLegacyError('');
    setLegacyComplete(false);
    try {
      const token = await getToken();
      if (!token) throw new Error('Iniciá sesión nuevamente para comprobar las fotos.');
      const origin = import.meta.env.VITE_ECHO_API_ORIGIN?.trim()?.replace(/\/$/, '') || '';
      const headers = { Authorization: `Bearer ${token}` };
      const [inventoryResponse, usageResponse] = await Promise.all([
        fetch(`${origin}/api/storage/recovery/inventory`, { headers, cache: 'no-store' }),
        fetch(`${origin}/api/storage/recovery/usage`, { headers, cache: 'no-store' }),
      ]);
      if (!inventoryResponse.ok) throw new Error(`No se pudo cargar el inventario (HTTP ${inventoryResponse.status}).`);
      const inventory = await inventoryResponse.json() as { paths: LegacyEntry[] };
      if (!Array.isArray(inventory.paths)) throw new Error('El inventario devolvió datos inválidos.');
      if (usageResponse.ok) {
        const usage = await usageResponse.json() as { universes: LegacyUsage[] };
        if (Array.isArray(usage.universes)) setLegacyUsage(usage.universes);
      }
      setLegacyProgress({ checked: 0, total: inventory.paths.length });
      for (let i = 0; i < inventory.paths.length; i += 30) {
        const paths = inventory.paths.slice(i, i + 30).map(entry => entry.path);
        // A failed batch must not erase earlier successful checks.
        try {
          const response = await fetch(`${origin}/api/storage/recovery/check-legacy`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
            cache: 'no-store',
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json() as { results: LegacyCheck[] };
          if (!Array.isArray(data.results) || data.results.length !== paths.length) throw new Error('Respuesta incompleta');
          setLegacyResults(previous => [...previous, ...data.results]);
        } catch {
          setLegacyResults(previous => [...previous, ...paths.map(path => ({ path, status: 'unknown' as const }))]);
        }
        setLegacyProgress({ checked: Math.min(i + paths.length, inventory.paths.length), total: inventory.paths.length });
      }
      setLegacyComplete(true);
    } catch (e) {
      setLegacyError(e instanceof Error ? e.message : 'No se pudo consultar Supabase.');
    } finally {
      setLegacyBusy(false);
    }
  }
  const legacyCounts = {
    available: legacyResults.filter(item => item.status === 'available').length,
    missing: legacyResults.filter(item => item.status === 'missing').length,
    unknown: legacyResults.filter(item => item.status === 'unknown').length,
    notOwned: legacyResults.filter(item => item.status === 'not_owned').length,
  };
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
      <section className="rounded-2xl border border-border p-4 space-y-3" aria-label="Recuperación de fotos antiguas">
        <h2 className="font-semibold">Recuperación de fotos antiguas</h2>
        <p className="text-sm text-muted-foreground">Comprobá cuáles de tus fotos antiguas siguen en Supabase. Esta consulta no copia, reemplaza ni borra archivos.</p>
        <button type="button" disabled={legacyBusy} onClick={() => void checkLegacy()} className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{legacyBusy ? 'Revisando fotos…' : 'Comprobar fotos antiguas'}</button>
        {(legacyBusy || legacyComplete || legacyProgress.total > 0) && <div className="text-sm space-y-2" role="status" aria-live="polite">
          <p>Revisadas: {legacyProgress.checked} de {legacyProgress.total}</p>
          <progress className="w-full" value={legacyProgress.checked} max={Math.max(legacyProgress.total, 1)} />
          <p>Disponibles: {legacyCounts.available} · No encontradas: {legacyCounts.missing} · Sin confirmar: {legacyCounts.unknown}{legacyCounts.notOwned ? ` · No autorizadas: ${legacyCounts.notOwned}` : ''}</p>
          {legacyComplete && <p className="text-muted-foreground">Comprobación terminada. No se modificó ninguna foto.</p>}
        </div>}
        {legacyUsage.length > 0 && <div className="text-sm space-y-1">
          <p className="font-medium">Referencias antiguas por universo</p>
          {legacyUsage.map((entry, index) => <p key={index} className="text-muted-foreground">Universo {index + 1}: {[entry.legacy_posts && 'publicaciones', entry.legacy_stories && 'historias', entry.legacy_characters && 'personajes'].filter(Boolean).join(', ') || 'sin referencias detectadas'}</p>)}
        </div>}
        {legacyError && <p role="alert" className="text-sm text-destructive">{legacyError}</p>}
      </section>
      <Link href="/settings" className="block text-sm underline">Volver a ajustes</Link>
    </div>
  </div>;
}
