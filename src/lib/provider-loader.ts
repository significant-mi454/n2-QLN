// QLN — Provider manifest loader (providers/*.json → registry auto-registration)
// Includes hot reload via fs.watch for development
import fs from 'fs';
import path from 'path';
import { inferCategory } from './schema';
import type { Registry } from './registry';
import type { ProviderManifest, ProviderLoadResult, RawToolEntry } from '../types';

/** Required fields for a valid provider manifest. */
const REQUIRED_MANIFEST_FIELDS: readonly string[] = ['provider', 'tools'];

/** Required fields for each tool entry within a manifest. */
const REQUIRED_TOOL_FIELDS: readonly string[] = ['name', 'description'];

/**
 * Load all provider manifests from a directory and register their tools.
 */
export function loadProviders(providersDir: string, registry: Registry): ProviderLoadResult {
  const result: ProviderLoadResult = { loaded: 0, skipped: 0, failed: 0, details: [] };

  if (!fs.existsSync(providersDir)) return result;

  const files = fs.readdirSync(providersDir)
    .filter((f: string) => f.endsWith('.json'));

  if (files.length === 0) return result;

  for (const file of files) {
    const filePath = path.join(providersDir, file);
    try {
      const manifest = _parseManifest(filePath);
      if (!manifest) {
        result.skipped++;
        result.details.push({ file, status: 'skipped', reason: 'invalid manifest' });
        continue;
      }

      const tools = _normalizeTools(manifest);
      if (tools.length === 0) {
        result.skipped++;
        result.details.push({ file, status: 'skipped', reason: 'no valid tools' });
        continue;
      }

      // Idempotent: purge old entries from this provider before re-registering
      registry.purgeBySource(`provider:${manifest.provider}`);

      const count = registry.registerBatch(tools);
      result.loaded += count;
      result.details.push({
        file,
        status: 'loaded',
        provider: manifest.provider,
        toolCount: count,
      });
    } catch (err: unknown) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      result.details.push({ file, status: 'failed', reason: msg });
    }
  }

  return result;
}

/**
 * Parse and validate a manifest JSON file.
 */
function _parseManifest(filePath: string): ProviderManifest | null {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const manifest = JSON.parse(raw) as Record<string, unknown>;

  // Validate required fields
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!manifest[field]) return null;
  }

  // tools must be a non-empty array
  if (!Array.isArray(manifest.tools)) return null;

  return manifest as unknown as ProviderManifest;
}

/**
 * Normalize tool entries from a manifest for registry registration.
 * Injects provider metadata and assigns source = "provider:{name}".
 */
function _normalizeTools(manifest: ProviderManifest): RawToolEntry[] {
  const providerName = manifest.provider;
  const tools: RawToolEntry[] = [];

  for (const raw of manifest.tools) {
    // Skip tools missing required fields
    if (!raw.name || !raw.description) continue;

    tools.push({
      name: raw.name,
      description: raw.description,
      source: `provider:${providerName}`,
      category: raw.category || inferCategory(raw.name, 'provider'),
      provider: providerName,
      inputSchema: raw.inputSchema || null,
      triggers: raw.triggers || undefined,
      tags: raw.tags || [],
      examples: raw.examples || [],
      endpoint: raw.endpoint || '',
      boostKeywords: raw.boostKeywords || undefined,
    });
  }

  return tools;
}

/**
 * Watch providers directory for changes and auto-reload.
 * Debounces to avoid rapid-fire reloads.
 * @returns cleanup function to stop watching
 */
export function watchProviders(
  providersDir: string,
  registry: Registry,
  onReload?: (result: ProviderLoadResult) => void,
): () => void {
  if (!fs.existsSync(providersDir)) {
    console.error(`[QLN] Hot Reload: providers dir not found: ${providersDir}`);
    return () => {};
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 500;

  const watcher = fs.watch(providersDir, (eventType: string, filename: string | null) => {
    // Only react to .json file changes
    if (!filename || !filename.endsWith('.json')) return;

    // Debounce: collapse rapid changes into one reload
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.error(`[QLN] Hot Reload: ${eventType} ${filename} → reloading providers...`);
      try {
        const result = loadProviders(providersDir, registry);
        console.error(`[QLN] Hot Reload: ${result.loaded} tools reloaded`);
        if (onReload) onReload(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[QLN] Hot Reload error: ${msg}`);
      }
    }, DEBOUNCE_MS);
  });

  console.error(`[QLN] Hot Reload: watching ${providersDir}`);

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
    console.error('[QLN] Hot Reload: stopped');
  };
}
