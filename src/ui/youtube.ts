/** A YouTube video and/or playlist picked from a link. */
export interface YouTubeRef {
  videoId: string | null;
  listId: string | null;
}

const ID = /^[A-Za-z0-9_-]{11}$/;
const LIST = /^[A-Za-z0-9_-]{10,64}$/;
/** Privacy-enhanced embeds (fewer cookies until you press play). */
export const YT_ORIGIN = 'https://www.youtube-nocookie.com';

/**
 * The YouTube logo's play button (paths from Simple Icons, CC0; the logo is a trademark of
 * Google). Drawn in the box `viewBox`, 24 wide and 17 tall.
 */
export const YT_LOGO = {
  viewBox: '0 3.5 24 17',
  red: '#ff0033',
  body:
    'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z',
  play: 'M9.545 15.568V8.432L15.818 12z',
} as const;

/** The logo as inline SVG. */
export function youTubeLogoSvg(): string {
  return `<svg viewBox="${YT_LOGO.viewBox}" aria-hidden="true"><path fill="${YT_LOGO.red}" d="${YT_LOGO.body}"/><path fill="#fff" d="${YT_LOGO.play}"/></svg>`;
}

/**
 * Reads a YouTube link: watch?v=…, youtu.be/…, /live/…, /shorts/…, /embed/…, playlist?list=…
 * (with or without `www.`, `m.`, `music.`), or a bare 11-character video id. Null if it isn't one.
 */
export function parseYouTubeUrl(text: string): YouTubeRef | null {
  const s = text.trim();
  if (ID.test(s)) return { videoId: s, listId: null };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  const list = url.searchParams.get('list');
  const listId = list && LIST.test(list) ? list : null;
  let videoId: string | null = null;
  if (host === 'youtu.be') {
    videoId = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') videoId = url.searchParams.get('v');
    else if (['live', 'shorts', 'embed', 'v'].includes(parts[0] ?? '')) videoId = parts[1] ?? null;
    else if (parts[0] !== 'playlist') return null;
  } else {
    return null;
  }
  if (videoId !== null && !ID.test(videoId)) videoId = null;
  if (!videoId && !listId) return null;
  return { videoId, listId };
}

/** Embed address with the JS API on (commands by postMessage), autoplay, no related videos from other channels. */
export function embedUrl(ref: YouTubeRef, origin: string): string {
  const q = new URLSearchParams({ enablejsapi: '1', autoplay: '1', rel: '0', playsinline: '1', origin });
  if (ref.listId) q.set('list', ref.listId);
  const path = ref.videoId ? ref.videoId : 'videoseries';
  return `${YT_ORIGIN}/embed/${path}?${q.toString()}`;
}

/** Player states sent by the embed (YT.PlayerState). */
export const YT_STATE = { ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;
