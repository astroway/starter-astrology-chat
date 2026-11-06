import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  // Pin the root to this folder, so a lockfile in a parent directory is not taken for the workspace.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
};
