// QLN — L3 tool executor
// Execute tools via HTTP (localhost) or registered local handlers
const http = require('http');

/**
 * Tool executor — HTTP proxy + local function calls.
 *
 * Execution priority:
 *   1. Local registered handler (via addHandler)
 *   2. HTTP proxy (when endpoint configured)
 */
class Executor {
    /**
     * @param {object} config
     * @param {string} [config.httpEndpoint] - Tool execution HTTP endpoint (e.g. "http://127.0.0.1:PORT")
     * @param {number} [config.timeout=20000] - HTTP timeout (ms)
     */
    constructor(config = {}) {
        this._httpEndpoint = config.httpEndpoint || null;
        this._timeout = config.timeout || 20000;
        /** @type {Map<string, Function>} Local handlers */
        this._handlers = new Map();
    }

    /**
     * Register a local tool handler.
     * @param {string} name - Tool name
     * @param {Function} handler - (args) => Promise<unknown>
     */
    addHandler(name, handler) {
        this._handlers.set(name, handler);
    }

    /**
     * Execute a tool.
     * @param {string} name - Tool name
     * @param {object} args - Tool arguments
     * @returns {Promise<{result: unknown, source: string, elapsed: number}>}
     */
    async exec(name, args = {}) {
        const t0 = Date.now();

        // 1. Local handler first
        if (this._handlers.has(name)) {
            const handler = this._handlers.get(name);
            const result = await handler(args);
            return { result, source: 'local', elapsed: Date.now() - t0 };
        }

        // 2. HTTP proxy
        if (this._httpEndpoint) {
            const result = await this._execHttp(name, args);
            return { result, source: 'http', elapsed: Date.now() - t0 };
        }

        throw new Error(`No handler found for tool: ${name}. Register with addHandler() or set httpEndpoint.`);
    }

    /**
     * Dynamically set HTTP endpoint.
     * @param {string} endpoint - "http://127.0.0.1:PORT" format
     */
    setHttpEndpoint(endpoint) {
        this._httpEndpoint = endpoint;
    }

    /** @private HTTP POST /call → tool execution */
    _execHttp(name, args) {
        return new Promise((resolve, reject) => {
            const url = new URL(this._httpEndpoint);
            const bodyStr = JSON.stringify({ tool: name, args });
            const timer = setTimeout(() => reject(new Error(`timeout (${this._timeout}ms)`)), this._timeout);

            const req = http.request({
                hostname: url.hostname,
                port: url.port,
                path: '/call',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            }, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    clearTimeout(timer);
                    try {
                        const parsed = JSON.parse(body);
                        if (parsed.error) reject(new Error(parsed.error));
                        else resolve(parsed.result);
                    } catch {
                        reject(new Error(`Invalid response: ${body.slice(0, 200)}`));
                    }
                });
            });
            req.on('error', e => { clearTimeout(timer); reject(e); });
            req.write(bodyStr);
            req.end();
        });
    }
}

module.exports = { Executor };
