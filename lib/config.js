// QLN — Config loader (default + local deep merge)
const path = require('path');
const fs = require('fs');

/** Default configuration */
const defaults = {
    /** Data directory (SQLite, indices, etc.) */
    dataDir: path.join(__dirname, '..', 'data'),

    /** Embedding configuration */
    embedding: {
        enabled: true,
        model: 'nomic-embed-text',
        endpoint: 'http://127.0.0.1:11434',
    },

    /** Tool execution configuration */
    executor: {
        httpEndpoint: null,
        timeout: 20000,
    },

    /** Search configuration */
    search: {
        defaultTopK: 5,
        threshold: 0.1,
    },
};

/**
 * Load config — apply config.local.js overrides on top of defaults.
 * @returns {object} Merged config
 */
function loadConfig() {
    const config = JSON.parse(JSON.stringify(defaults));
    const localPath = path.join(__dirname, '..', 'config.local.js');

    if (fs.existsSync(localPath)) {
        try {
            const local = require(localPath);
            deepMerge(config, local);
        } catch (e) {
            console.warn(`[QLN] config.local.js load failed: ${e.message}`);
        }
    }
    return config;
}

/**
 * Deep merge (merge source into target).
 * @param {object} target
 * @param {object} source
 */
function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
            && target[key] && typeof target[key] === 'object') {
            deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
}

module.exports = { loadConfig, defaults };
