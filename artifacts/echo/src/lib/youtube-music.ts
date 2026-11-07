/**
 * YouTube link normalization for ECHO Music. No downloading or audio extraction.
 * Embedding requires the official YouTube player and the video's embed permission.
 */
export function parseYouTubeVideoId(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.split('/')[1] || null;
    else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split('/')[2] || null;
    }
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

export function youtubeWatchUrl(videoId: string): string {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) throw Error('INVALID_YOUTUBE_VIDEO_ID');
  return 'https://www.youtube.com/watch?v=' + videoId;
}
