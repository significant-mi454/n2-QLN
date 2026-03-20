// QLN — Provider manifest loader (providers/*.json → registry auto-registration)
const fs = require('fs');
const path = require('path');
const { inferCategory } = require('./schema');

/**
 * Required fields for a valid provider manifest.
 * @type {string[]}
 */
const REQUIRED_MANIFEST_FIELDS = ['provider', 'tools'];

/**
 * Required fields for each tool entry within a manifest.
 * @type {string[]}
 */
const REQUIRED_TOOL_FIELDS = ['name', 'description'];

/**
 * Load all provider manifests from a directory and register their tools.
 *
 * @param {string} providersDir - Absolute path to providers/ directory
 * @param {import('./registry').Registry} registry - QLN registry instance
 * @returns {{ loaded: number, skipped: number, failed: number, details: object[] }}
 */
function loadProviders(providersDir, registry) {
    const result = { loaded: 0, skipped: 0, failed: 0, details: [] };

    if (!fs.existsSync(providersDir)) return result;

    /** @type {string[]} */
    const files = fs.readdirSync(providersDir)
        .filter(f => f.endsWith('.json'));

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
        } catch (err) {
            result.failed++;
            result.details.push({ file, status: 'failed', reason: err.message });
        }
    }

    return result;
}

/**
 * Parse and validate a manifest JSON file.
 *
 * @param {string} filePath - Absolute path to JSON file
 * @returns {object|null} Parsed manifest or null if invalid
 */
function _parseManifest(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const manifest = JSON.parse(raw);

    // Validate required fields
    for (const field of REQUIRED_MANIFEST_FIELDS) {
        if (!manifest[field]) return null;
    }

    // tools must be a non-empty array
    if (!Array.isArray(manifest.tools)) return null;

    return manifest;
}

/**
 * Normalize tool entries from a manifest for registry registration.
 * Injects provider metadata and assigns source = "provider:{name}".
 *
 * @param {object} manifest - Validated manifest object
 * @returns {object[]} Array of normalized tool entries ready for registerBatch()
 */
function _normalizeTools(manifest) {
    const providerName = manifest.provider;
    const tools = [];

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
            triggers: raw.triggers || undefined, // let schema.js extract
            tags: raw.tags || [],
            examples: raw.examples || [],
            endpoint: raw.endpoint || '',
        });
    }

    return tools;
}

module.exports = { loadProviders };
