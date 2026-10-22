import { Socket, isIP } from "node:net";

const SAFE_ENVIRONMENT_KEYS = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "PWD",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "TERM",
  "USERPROFILE",
  "VITEST",
  "VITEST_POOL_ID",
  "VITEST_WORKER_ID",
  "WINDIR",
]);

const GUARD_MARKER = "__METEOAI_VITEST_NETWORK_GUARD_INSTALLED__";
const BLOCKED_NETWORK_CODE = "ERR_TEST_EXTERNAL_NETWORK_BLOCKED";
const BLOCKED_NETWORK_MESSAGE = "External network access is disabled in the default Vitest environment.";

type SocketTarget =
  | { kind: "host"; host: string }
  | { kind: "local-path" }
  | { kind: "unknown" };

type MutableSocketPrototype = {
  connect: (...args: unknown[]) => Socket;
};

/** Keep only non-secret process settings needed by Node, Vitest, and local test fixtures. */
export function sanitizeTestEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (!SAFE_ENVIRONMENT_KEYS.has(key.toUpperCase())) {
      delete process.env[key];
    }
  }
  process.env.NODE_ENV = "test";
}

/** Only explicit loopback destinations may be used by the default test suite. */
export function isLoopbackTestHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host === "::1") return true;
  if (isIP(host) === 4) return host.split(".")[0] === "127";
  return false;
}

export function isAllowedTestHttpUrl(input: string | URL): boolean {
  try {
    const url = input instanceof URL ? input : new URL(input);
    return (url.protocol === "http:" || url.protocol === "https:") && isLoopbackTestHost(url.hostname);
  } catch {
    return false;
  }
}

function createBlockedNetworkError(): Error & { code: string } {
  return Object.assign(new Error(BLOCKED_NETWORK_MESSAGE), { code: BLOCKED_NETWORK_CODE });
}

function getSocketTarget(args: unknown[]): SocketTarget {
  const [first, second] = args;
  // Node can pass a normalized [options, callback] tuple as the first argument.
  // Inspect its real target recursively instead of rejecting valid loopback fixtures.
  if (Array.isArray(first)) return getSocketTarget(first);
  if (typeof first === "string") return { kind: "local-path" };
  if (typeof first === "number") {
    return { kind: "host", host: typeof second === "string" ? second : "localhost" };
  }
  if (first && typeof first === "object") {
    const options = first as Record<string, unknown>;
    if (typeof options.path === "string" && options.path.length > 0) return { kind: "local-path" };
    if (typeof options.host === "string" && options.host.length > 0) return { kind: "host", host: options.host };
    if (typeof options.hostname === "string" && options.hostname.length > 0) return { kind: "host", host: options.hostname };
    if (typeof options.port === "number") return { kind: "host", host: "localhost" };
  }
  return { kind: "unknown" };
}

/**
 * Install process-wide guards for fetch and Node TCP sockets. HTTP libraries such
 * as Axios ultimately use Socket.connect; local loopback fixtures remain usable.
 */
export function installTestNetworkGuard(): void {
  const guardedGlobal = globalThis as typeof globalThis & Record<string, unknown>;
  if (guardedGlobal[GUARD_MARKER] === true) return;

  const nativeFetch = globalThis.fetch;
  if (typeof nativeFetch === "function") {
    globalThis.fetch = function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const requestUrl = input instanceof URL ? input : typeof input === "string" ? input : input.url;
      if (!isAllowedTestHttpUrl(requestUrl)) return Promise.reject(createBlockedNetworkError());
      return nativeFetch.call(globalThis, input, init);
    };
  }

  const socketPrototype = Socket.prototype as unknown as MutableSocketPrototype;
  const nativeConnect = socketPrototype.connect;
  socketPrototype.connect = function guardedSocketConnect(this: Socket, ...args: unknown[]): Socket {
    const target = getSocketTarget(args);
    if (target.kind === "unknown" || (target.kind === "host" && !isLoopbackTestHost(target.host))) {
      throw createBlockedNetworkError();
    }
    return nativeConnect.apply(this, args);
  };

  guardedGlobal[GUARD_MARKER] = true;
}

export { BLOCKED_NETWORK_CODE };
