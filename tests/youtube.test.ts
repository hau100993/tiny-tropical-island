import { describe, expect, it } from 'vitest';
import { embedUrl, parseYouTubeUrl } from '../src/ui/youtube';

describe('YouTube links', () => {
  it('reads the usual link shapes', () => {
    const v = { videoId: 'jfKfPfyJRdk', listId: null };
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=jfKfPfyJRdk')).toEqual(v);
    expect(parseYouTubeUrl('https://youtu.be/jfKfPfyJRdk?si=abc')).toEqual(v);
    expect(parseYouTubeUrl('youtube.com/live/jfKfPfyJRdk')).toEqual(v);
    expect(parseYouTubeUrl('https://m.youtube.com/shorts/jfKfPfyJRdk')).toEqual(v);
    expect(parseYouTubeUrl('https://music.youtube.com/watch?v=jfKfPfyJRdk&t=30')).toEqual(v);
    expect(parseYouTubeUrl('  jfKfPfyJRdk ')).toEqual(v);
  });

  it('keeps a playlist', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')).toEqual({
      videoId: null,
      listId: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
    });
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=jfKfPfyJRdk&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')?.listId).toBe(
      'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
    );
  });

  it('refuses other sites and broken links', () => {
    expect(parseYouTubeUrl('https://vimeo.com/123456')).toBeNull();
    expect(parseYouTubeUrl('https://open.spotify.com/track/abc')).toBeNull();
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseYouTubeUrl('not a link')).toBeNull();
  });

  it('builds a privacy-enhanced embed with the JS API', () => {
    const u = embedUrl({ videoId: 'jfKfPfyJRdk', listId: null }, 'http://localhost:5173');
    expect(u.startsWith('https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?')).toBe(true);
    expect(u).toContain('enablejsapi=1');
    expect(embedUrl({ videoId: null, listId: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' }, 'x')).toContain('/embed/videoseries?');
  });
});
