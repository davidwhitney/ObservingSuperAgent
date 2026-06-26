import { readFileSync, existsSync } from 'node:fs';
import { configSchema, type Config } from './schema';

const ENV_PREFIX = 'OSA_';
const PATH_SEPARATOR = '__';

type Json = Record<string, unknown>;

/**
 * Overlay `OSA_`-prefixed environment variables onto a base config object.
 *
 * The remainder of the variable name is split on `__` to form a path, e.g.
 * `OSA_JIRA__BASEURL` -> `jira.baseUrl`. Path segments match existing keys
 * case-insensitively (so uppercase env vars override camelCase config keys);
 * unmatched segments are used verbatim. Values are parsed as JSON when possible
 * (so numbers, booleans and arrays work), otherwise kept as strings.
 */
export function applyEnvOverlay(base: Json, env: NodeJS.ProcessEnv = process.env): Json {
  const out = structuredClone(base);
  for (const [rawKey, rawValue] of Object.entries(env)) {
    if (!rawKey.startsWith(ENV_PREFIX) || rawValue === undefined) continue;
    const path = rawKey.slice(ENV_PREFIX.length).split(PATH_SEPARATOR).filter(Boolean);
    if (path.length === 0) continue;
    setPath(out, path, parseValue(rawValue));
  }
  return out;
}

function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function setPath(target: Json, path: string[], value: unknown): void {
  let node: Json = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = resolveKey(node, path[i]!);
    const next = node[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      node[key] = {};
    }
    node = node[key] as Json;
  }
  node[resolveKey(node, path[path.length - 1]!)] = value;
}

/** Find an existing key matching `segment` case-insensitively, else return the segment. */
function resolveKey(node: Json, segment: string): string {
  const lower = segment.toLowerCase();
  for (const key of Object.keys(node)) {
    if (key.toLowerCase() === lower) return key;
  }
  return segment;
}

export interface LoadOptions {
  /** Explicit config file path. Defaults to OSA_CONFIG env, then ./config.json. */
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}

/** Load config from a JSON file (if present) overlaid with environment variables. */
export function loadConfig(options: LoadOptions = {}): Config {
  const env = options.env ?? process.env;
  const path = options.configPath ?? env.OSA_CONFIG ?? 'config.json';

  let fileConfig: Json = {};
  if (existsSync(path)) {
    fileConfig = JSON.parse(readFileSync(path, 'utf8')) as Json;
  }

  const merged = applyEnvOverlay(fileConfig, env);
  return configSchema.parse(merged);
}
