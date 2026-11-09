import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';

export function SharedMusicPlayer({ trackId }: { trackId: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl(''); setError('');
    void customFetch<Blob>('/api/music/published/' + encodeURIComponent(trackId) + '/audio', { responseType: 'blob' })
      .then(blob => {
        if (!blob.type.startsWith('audio/')) throw new Error('Unsupported audio');
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => { if (active) setError('No se pudo cargar la canción.'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [trackId]);
  if (error) return <p role="alert" className="text-xs text-destructive">{error}</p>;
  if (!url) return <p className="text-xs text-muted-foreground">Cargando audio…</p>;
  return <audio controls preload="metadata" className="w-full max-w-64" src={url} />;
}
