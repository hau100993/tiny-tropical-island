import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Audio formats Chrome/Edge can decode with `decodeAudioData`. */
const AUDIO_EXT = /\.(ogg|oga|opus|mp3|wav|m4a|aac|flac|webm)$/i;
const MANIFEST = 'audio-manifest.json';

export interface AudioManifest {
  /** Audio files under the audio folder, as forward-slash paths relative to it. */
  files: string[];
  /** Whether `audio/config.json` exists (so the app never requests a missing file). */
  config: boolean;
}

function scan(audioDir: string): AudioManifest {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (AUDIO_EXT.test(name)) files.push(relative(audioDir, full).split('\\').join('/'));
    }
  };
  if (existsSync(audioDir)) walk(audioDir);
  files.sort();
  return { files, config: existsSync(join(audioDir, 'config.json')) };
}

/**
 * Lists the audio files that actually exist under `audio/` as `audio-manifest.json`, so the app
 * only fetches files that are there and a missing file never shows up as a red 404.
 * Dev and preview servers rescan on every request (drop a file in, reload the page); a build
 * writes the list once into `dist/`.
 */
export function audioManifest(): Plugin {
  let publicDir = '';
  let outDir = '';
  return {
    name: 'tsw-audio-manifest',
    configResolved(config) {
      publicDir = config.publicDir;
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== `/${MANIFEST}`) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(scan(join(publicDir, 'audio'))));
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split('?')[0].endsWith(`/${MANIFEST}`)) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(scan(join(outDir, 'audio'))));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: MANIFEST, source: JSON.stringify(scan(join(publicDir, 'audio'))) });
    },
  };
}
