// QLN — SQLite storage engine (pure JS via sql.js WASM). No native dependencies.
const fs = require('fs');
const path = require('path');

/** @type {object|null} sql.js module singleton */
let _SQL = null;
/** @type {Promise<object>|null} sql.js init promise */
let _initPromise = null;

/**
 * Initialize sql.js WASM module (once per process).
 * @returns {Promise<object>} sql.js module with Database constructor
 */
async function initSqlJs() {
    if (_SQL) return _SQL;
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        const initFn = require('sql.js');
        _SQL = await initFn();
        return _SQL;
    })();
    return _initPromise;
}

/**
 * QLN SQLite store.
 * Dedicated tool index DB — separated from Soul KV-Cache.
 *
 * File: {dataDir}/qln-tools.sqlite
 */
class Store {
    /**
     * @param {string} dataDir - Data directory path
     */
    constructor(dataDir) {
        this._dataDir = dataDir;
        this._db = null;
        this._dbPath = path.join(dataDir, 'qln-tools.sqlite');
    }

    /** Async init — load sql.js + open DB + create schema */
    async init() {
        await initSqlJs();
        if (!fs.existsSync(this._dataDir)) {
            fs.mkdirSync(this._dataDir, { recursive: true });
        }
        if (fs.existsSync(this._dbPath)) {
            const buffer = fs.readFileSync(this._dbPath);
            this._db = new _SQL.Database(buffer);
        } else {
            this._db = new _SQL.Database();
        }
        this._createSchema();
    }

    /** Create tools + providers table schema */
    _createSchema() {
        this._db.run(`
            CREATE TABLE IF NOT EXISTS tools (
                name TEXT PRIMARY KEY,
                description TEXT DEFAULT '',
                source TEXT DEFAULT 'unknown',
                category TEXT DEFAULT 'misc',
                provider TEXT DEFAULT '',
                input_schema TEXT DEFAULT '{}',
                triggers TEXT DEFAULT '[]',
                tags TEXT DEFAULT '[]',
                examples TEXT DEFAULT '[]',
                endpoint TEXT DEFAULT '',
                search_text TEXT DEFAULT '',
                embedding TEXT DEFAULT '',
                usage_count INTEGER DEFAULT 0,
                success_rate REAL DEFAULT 1.0,
                registered_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);
        this._db.run(`CREATE INDEX IF NOT EXISTS idx_tools_source ON tools(source)`);
        this._db.run(`CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category)`);

        this._db.run(`
            CREATE TABLE IF NOT EXISTS providers (
                name TEXT PRIMARY KEY,
                version TEXT DEFAULT '1.0.0',
                description TEXT DEFAULT '',
                endpoint TEXT DEFAULT '',
                tool_count INTEGER DEFAULT 0,
                registered_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);

        // Safe migration: add new columns if missing (for existing DBs)
        this._migrateSchema();
    }

    /** Schema migration — safe ADD COLUMN (ignores if already exists) */
    _migrateSchema() {
        const addCol = (table, col, type, dflt) => {
            try {
                this._db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type} DEFAULT ${dflt}`);
            } catch { /* column already exists */ }
        };
        addCol('tools', 'provider', 'TEXT', "''");
        addCol('tools', 'examples', 'TEXT', "'[]'");
        addCol('tools', 'endpoint', 'TEXT', "''");
        addCol('tools', 'last_used_at', 'TEXT', 'NULL');

        // Copy plugin_name → provider (if old schema has plugin_name)
        try {
            const cols = this._db.exec("PRAGMA table_info(tools)");
            if (cols.length > 0) {
                const colNames = cols[0].values.map(r => r[1]);
                if (colNames.includes('plugin_name') && colNames.includes('provider')) {
                    this._db.run("UPDATE tools SET provider = plugin_name WHERE provider = '' AND plugin_name != ''");
                }
            }
        } catch { /* table doesn't exist yet */ }

        // Create provider index (safe)
        try {
            this._db.run(`CREATE INDEX IF NOT EXISTS idx_tools_provider ON tools(provider)`);
        } catch { /* already exists */ }
    }

    /**
     * Upsert a tool entry.
     * @param {object} entry - Normalized tool entry
     */
    upsert(entry) {
        this._db.run(`
            INSERT INTO tools (name, description, source, category, provider,
                input_schema, triggers, tags, examples, endpoint, search_text, embedding,
                usage_count, success_rate, last_used_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, COALESCE(?, (SELECT embedding FROM tools WHERE name = ?)),
                ?, ?, ?, datetime('now'))
            ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                source = excluded.source,
                category = excluded.category,
                provider = excluded.provider,
                input_schema = excluded.input_schema,
                triggers = excluded.triggers,
                tags = excluded.tags,
                examples = excluded.examples,
                endpoint = excluded.endpoint,
                search_text = excluded.search_text,
                embedding = COALESCE(excluded.embedding, tools.embedding),
                usage_count = excluded.usage_count,
                success_rate = excluded.success_rate,
                last_used_at = excluded.last_used_at,
                updated_at = excluded.updated_at
        `, [
            entry.name, entry.description, entry.source, entry.category, entry.provider,
            JSON.stringify(entry.inputSchema), JSON.stringify(entry.triggers),
            JSON.stringify(entry.tags), JSON.stringify(entry.examples), entry.endpoint || '',
            entry.searchText,
            entry.embedding ? JSON.stringify(entry.embedding) : null, entry.name,
            entry.usageCount, entry.successRate, entry.lastUsedAt || null,
        ]);
        this._persist();
    }

    /**
     * Remove a tool by name.
     * @param {string} name
     * @returns {boolean}
     */
    remove(name) {
        this._db.run('DELETE FROM tools WHERE name = ?', [name]);
        this._persist();
        return true;
    }

    /**
     * Purge all tools by source (for re-sync).
     * @param {string} source
     */
    purgeBySource(source) {
        this._db.run('DELETE FROM tools WHERE source = ?', [source]);
        this._persist();
    }

    /**
     * Load all tools from DB.
     * @returns {object[]} Array of SQLite rows
     */
    loadAll() {
        const results = this._db.exec('SELECT * FROM tools ORDER BY name');
        if (results.length === 0) return [];
        const cols = results[0].columns;
        return results[0].values.map(row => {
            const obj = {};
            cols.forEach((c, i) => { obj[c] = row[i]; });
            return obj;
        });
    }

    /** Persist DB to disk */
    _persist() {
        if (!this._db) return;
        const data = this._db.export();
        fs.writeFileSync(this._dbPath, Buffer.from(data));
    }

    /** Close connection */
    dispose() {
        if (this._db) {
            this._persist();
            this._db.close();
            this._db = null;
        }
    }
}

module.exports = { Store, initSqlJs };
