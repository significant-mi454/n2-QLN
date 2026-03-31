// QLN — L3 tool executor with Circuit Breaker
// Execute tools via HTTP (localhost) or registered local handlers
// Circuit Breaker: auto-disable tools after consecutive failures
import http from 'http';
import type { ExecResult, ToolHandler, CircuitBreakerConfig, CircuitState } from '../types';

interface ExecutorConfig {
  httpEndpoint?: string | null;
  timeout?: number;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
}

/** Per-tool circuit breaker state */
interface CircuitEntry {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  lastAttempt: number;
}

/**
 * Tool executor — HTTP proxy + local function calls + Circuit Breaker.
 *
 * Execution priority:
 *   1. Circuit breaker check (reject if open)
 *   2. Local registered handler (via addHandler)
 *   3. HTTP proxy (when endpoint configured)
 *
 * Circuit Breaker states:
 *   closed    → normal, requests pass through
 *   open      → tool disabled, fast-fail (after N consecutive failures)
 *   half-open → recovery attempt (after recovery timeout)
 */
export class Executor {
  private _httpEndpoint: string | null;
  private _timeout: number;
  private _handlers: Map<string, ToolHandler>;
  private _circuits: Map<string, CircuitEntry>;
  private _cbConfig: CircuitBreakerConfig;

  constructor(config: ExecutorConfig = {}) {
    this._httpEndpoint = config.httpEndpoint || null;
    this._timeout = config.timeout || 20000;
    this._handlers = new Map();
    this._circuits = new Map();
    this._cbConfig = {
      failureThreshold: config.circuitBreaker?.failureThreshold ?? 3,
      recoveryTimeout: config.circuitBreaker?.recoveryTimeout ?? 60000,
    };
  }

  /** Register a local tool handler. */
  addHandler(name: string, handler: ToolHandler): void {
    this._handlers.set(name, handler);
  }

  /** Execute a tool (with circuit breaker protection). */
  async exec(name: string, args: Record<string, unknown> = {}): Promise<ExecResult> {
    const circuit = this._checkCircuit(name);
    const t0 = Date.now();
    circuit.lastAttempt = t0;

    try {
      const result = await this._dispatch(name, args, t0);
      this._recordSuccess(name);
      return result;
    } catch (err) {
      if (!(err as Record<string, unknown>).__qlnConfigError) {
        this._recordFailure(name);
      }
      throw err;
    }
  }

  /** @internal Route to handler or HTTP proxy. */
  private async _dispatch(name: string, args: Record<string, unknown>, t0: number): Promise<ExecResult> {
    if (this._handlers.has(name)) {
      const output = await this._handlers.get(name)!(args);
      return { result: output, source: 'local', elapsed: Date.now() - t0 };
    }
    if (this._httpEndpoint) {
      const output = await this._execHttp(name, args);
      return { result: output, source: 'http', elapsed: Date.now() - t0 };
    }
    throw Object.assign(
      new Error(`No handler found for tool: ${name}. Register with addHandler() or set httpEndpoint.`),
      { __qlnConfigError: true },
    );
  }

  /** @internal Circuit breaker gate — throws if tool is disabled. */
  private _checkCircuit(name: string): CircuitEntry {
    const circuit = this._getCircuit(name);
    if (circuit.state === 'open') {
      const elapsed = Date.now() - circuit.lastFailure;
      if (elapsed < this._cbConfig.recoveryTimeout) {
        throw new Error(
          `[Circuit Breaker] ${name} is disabled (${circuit.failures} failures). ` +
          `Recovery in ${Math.ceil((this._cbConfig.recoveryTimeout - elapsed) / 1000)}s.`,
        );
      }
      circuit.state = 'half-open';
    }
    return circuit;
  }

  /** Get circuit breaker state for a tool. */
  getCircuitState(name: string): { state: CircuitState; failures: number } {
    const c = this._circuits.get(name);
    if (!c) return { state: 'closed', failures: 0 };
    // Check for auto-recovery
    if (c.state === 'open' && (Date.now() - c.lastFailure) >= this._cbConfig.recoveryTimeout) {
      return { state: 'half-open', failures: c.failures };
    }
    return { state: c.state, failures: c.failures };
  }

  /** Manually reset circuit breaker for a tool. */
  resetCircuit(name: string): void {
    this._circuits.delete(name);
  }

  /** Get all tripped circuits (for stats). */
  getTrippedCircuits(): Array<{ name: string; failures: number; state: CircuitState }> {
    const tripped: Array<{ name: string; failures: number; state: CircuitState }> = [];
    for (const [name, entry] of this._circuits) {
      if (entry.state !== 'closed') {
        tripped.push({ name, failures: entry.failures, state: entry.state });
      }
    }
    return tripped;
  }

  /** Dynamically set HTTP endpoint. */
  setHttpEndpoint(endpoint: string): void {
    this._httpEndpoint = endpoint;
  }

  // ── Circuit Breaker internals ──

  private _getCircuit(name: string): CircuitEntry {
    if (!this._circuits.has(name)) {
      this._circuits.set(name, { state: 'closed', failures: 0, lastFailure: 0, lastAttempt: 0 });
    }
    return this._circuits.get(name)!;
  }

  private _recordSuccess(name: string): void {
    const circuit = this._getCircuit(name);
    circuit.state = 'closed';
    circuit.failures = 0;
  }

  private _recordFailure(name: string): void {
    const circuit = this._getCircuit(name);
    circuit.failures++;
    circuit.lastFailure = Date.now();
    if (circuit.failures >= this._cbConfig.failureThreshold) {
      circuit.state = 'open';
      console.error(`[QLN] Circuit Breaker: ${name} tripped (${circuit.failures} failures)`);
    }
  }

  /** @internal HTTP POST /call → tool execution */
  private _execHttp(name: string, args: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const url = new URL(this._httpEndpoint!);
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
      }, (res: http.IncomingMessage) => {
        let body = '';
        res.on('data', (c: Buffer) => body += c);
        res.on('end', () => {
          clearTimeout(timer);
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            if (parsed.error) reject(new Error(parsed.error as string));
            else resolve(parsed.result);
          } catch {
            reject(new Error(`Invalid response: ${body.slice(0, 200)}`));
          }
        });
      });
      req.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
      req.write(bodyStr);
      req.end();
    });
  }
}
