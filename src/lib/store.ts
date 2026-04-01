// QLN — SQLite storage engine (pure JS via sql.js WASM). No native dependencies.
import fs from 'fs';
import path from 'path';
import type { ToolEntry, SqlJsDatabase, SqlJsStatic } from '../types';

/** sql.js module singleton */
let _SQL: SqlJsStatic | null = null;
/** sql.js init promise */
let _initPromise: Promise<SqlJsStatic> | null = null;

/**
 * Initialize sql.js WASM module (once per process).
 */
async function initSqlJs(): Promise<SqlJsStatic> {
  if (_SQL) return _SQL;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    // sql.js uses CJS export — require is needed here
    const initFn = require('sql.js') as (config?: Record<string, unknown>) => Promise<SqlJsStatic>;
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
export class Store {
  private _dataDir: string;
  private _db: SqlJsDatabase | null;
  private _dbPath: string;
  private _batchMode: boolean;
  private _batchDirty: boolean;

  constructor(dataDir: string) {
    this._dataDir = dataDir;
    this._db = null;
    this._dbPath = path.join(dataDir, 'qln-tools.sqlite');
    this._batchMode = false;
    this._batchDirty = false;
  }

  /** Async init — load sql.js + open DB + create schema */
  async init(): Promise<void> {
    const SQL = await initSqlJs();
    if (!fs.existsSync(this._dataDir)) {
      fs.mkdirSync(this._dataDir, { recursive: true });
    }
    if (fs.existsSync(this._dbPath)) {
      const buffer = fs.readFileSync(this._dbPath);
      this._db = new SQL.Database(buffer);
    } else {
      this._db = new SQL.Database();
    }
    this._createSchema();
  }

  /** Create tools + providers table schema */
  private _createSchema(): void {
    this._db!.run(`
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
    this._db!.run(`CREATE INDEX IF NOT EXISTS idx_tools_source ON tools(source)`);
    this._db!.run(`CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category)`);

    this._db!.run(`
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

    this._migrateSchema();
  }

  /** Schema migration — safe ADD COLUMN (ignores if already exists) */
  private _migrateSchema(): void {
    const addCol = (table: string, col: string, type: string, dflt: string): void => {
      try {
        this._db!.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type} DEFAULT ${dflt}`);
      } catch { /* column already exists */ }
    };
    addCol('tools', 'provider', 'TEXT', "''");
    addCol('tools', 'examples', 'TEXT', "'[]'");
    addCol('tools', 'endpoint', 'TEXT', "''");
    addCol('tools', 'last_used_at', 'TEXT', 'NULL');
    // v4.1.0: boostKeywords + Circuit Breaker
    addCol('tools', 'boost_keywords', 'TEXT', "''");
    addCol('tools', 'consecutive_failures', 'INTEGER', '0');

    // Copy plugin_name → provider (if old schema has plugin_name)
    try {
      const cols = this._db!.exec("PRAGMA table_info(tools)");
      if (cols.length > 0) {
        const colNames = cols[0].values.map(r => r[1] as string);
        if (colNames.includes('plugin_name') && colNames.includes('provider')) {
          this._db!.run("UPDATE tools SET provider = plugin_name WHERE provider = '' AND plugin_name != ''");
        }
      }
    } catch { /* table doesn't exist yet */ }

    try {
      this._db!.run(`CREATE INDEX IF NOT EXISTS idx_tools_provider ON tools(provider)`);
    } catch { /* already exists */ }
  }

  /**
   * Enter batch mode — suppresses per-upsert disk writes.
   * Call endBatch() when done to flush once.
   */
  beginBatch(): void {
    this._batchMode = true;
    this._batchDirty = false;
  }

  /**
   * Exit batch mode — flush to disk if any writes occurred.
   */
  endBatch(): void {
    this._batchMode = false;
    if (this._batchDirty) {
      this._persist();
      this._batchDirty = false;
    }
  }

  /** Upsert a tool entry. */
  upsert(entry: ToolEntry): void {
    this._db!.run(`
      INSERT INTO tools (name, description, source, category, provider,
        input_schema, triggers, tags, examples, endpoint, search_text, boost_keywords,
        embedding, usage_count, success_rate, consecutive_failures, last_used_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, COALESCE(?, (SELECT embedding FROM tools WHERE name = ?)),
        ?, ?, ?, ?, datetime('now'))
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
        boost_keywords = excluded.boost_keywords,
        embedding = COALESCE(excluded.embedding, tools.embedding),
        usage_count = excluded.usage_count,
        success_rate = excluded.success_rate,
        consecutive_failures = excluded.consecutive_failures,
        last_used_at = excluded.last_used_at,
        updated_at = excluded.updated_at
    `, [
      entry.name, entry.description, entry.source, entry.category, entry.provider,
      JSON.stringify(entry.inputSchema), JSON.stringify(entry.triggers),
      JSON.stringify(entry.tags), JSON.stringify(entry.examples), entry.endpoint || '',
      entry.searchText, entry.boostKeywords || '',
      entry.embedding ? JSON.stringify(entry.embedding) : null, entry.name,
      entry.usageCount, entry.successRate, entry.consecutiveFailures || 0,
      entry.lastUsedAt || null,
    ]);
    if (this._batchMode) {
      this._batchDirty = true;
    } else {
      this._persist();
    }
  }

  /** Remove a tool by name. */
  remove(name: string): boolean {
    this._db!.run('DELETE FROM tools WHERE name = ?', [name]);
    this._persist();
    return true;
  }

  /** Purge all tools by source (for re-sync). */
  purgeBySource(source: string): void {
    this._db!.run('DELETE FROM tools WHERE source = ?', [source]);
    this._persist();
  }

  /** Load all tools from DB. */
  loadAll(): Record<string, unknown>[] {
    const results = this._db!.exec('SELECT * FROM tools ORDER BY name');
    if (results.length === 0) return [];
    const cols = results[0].columns;
    return results[0].values.map(row => {
      const obj: Record<string, unknown> = {};
      cols.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    });
  }

  /** Persist DB to disk */
  private _persist(): void {
    if (!this._db) return;
    const data = this._db.export();
    fs.writeFileSync(this._dbPath, Buffer.from(data));
  }

  /** Close connection */
  dispose(): void {
    if (this._db) {
      this._persist();
      this._db.close();
      this._db = null;
    }
  }
}

export { initSqlJs };
