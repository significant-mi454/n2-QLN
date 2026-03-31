// QLN — Config loader (default + local deep merge)
import path from 'path';
import fs from 'fs';
import type { QLNConfig } from '../types';

/** Default configuration */
const defaults: QLNConfig = {
  dataDir: path.join(__dirname, '..', '..', 'data'),
  embedding: {
    enabled: true,
    model: 'nomic-embed-text',
    endpoint: 'http://127.0.0.1:11434',
  },
  executor: {
    httpEndpoint: null,
    timeout: 20000,
  },
  providers: {
    enabled: true,
    dir: path.join(__dirname, '..', '..', 'providers'),
  },
  search: {
    defaultTopK: 5,
    threshold: 0.1,
    sourceWeights: { mcp: 1.2, plugin: 1.0, local: 0.8 },
  },
};

/**
 * Load config — apply config.local.js overrides on top of defaults.
 */
export function loadConfig(): QLNConfig {
  const config: QLNConfig = JSON.parse(JSON.stringify(defaults));
  const localPath = path.join(__dirname, '..', '..', 'config.local.js');

  if (fs.existsSync(localPath)) {
    try {
      // config.local.js is a CJS module — require is intentional
      const local = require(localPath) as Partial<QLNConfig>;
      deepMerge(config as unknown as Record<string, unknown>, local as unknown as Record<string, unknown>);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[QLN] config.local.js load failed: ${msg}`);
    }
  }
  return config;
}

/**
 * Deep merge (merge source into target).
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
        && target[key] && typeof target[key] === 'object') {
      deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      target[key] = source[key];
    }
  }
}

export { defaults };
