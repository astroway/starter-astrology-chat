import { fileURLToPath } from 'node:url';

// BASE_PATH serves the app under a subpath, e.g. /demo/chat; empty means the site root.
const basePath = (process.env.BASE_PATH || '').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // Pin the root to this folder, so a lockfile in a parent directory is not taken for the workspace.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
};
