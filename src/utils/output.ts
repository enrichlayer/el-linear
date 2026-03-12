import { logger } from "./logger.js";

const warningBuffer: string[] = [];
let rawMode = false;

export function setRawMode(enabled: boolean): void {
  rawMode = enabled;
}

export function outputSuccess(data: unknown): void {
  const warnings = drainWarnings();
  let output: unknown;
  if (warnings.length > 0 && data !== null && typeof data === "object" && !Array.isArray(data)) {
    output = { ...(data as Record<string, unknown>), _warnings: warnings };
  } else {
    output = data;
  }
  // --raw: unwrap { data: [...] } to just the array
  if (rawMode && output !== null && typeof output === "object" && !Array.isArray(output)) {
    const obj = output as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      output = obj.data;
    }
  }
  logger.info(JSON.stringify(output, null, 2));
}

export function outputWarning(message: string | string[], _type?: string): void {
  const messages = Array.isArray(message) ? message : [message];
  for (const msg of messages) {
    warningBuffer.push(msg);
  }
  // Warnings are buffered and embedded as _warnings in the next outputSuccess call.
  // No stderr output — this prevents multi-JSON corruption when callers use 2>&1.
}

function drainWarnings(): string[] {
  const warnings = [...warningBuffer];
  warningBuffer.length = 0;
  return warnings;
}

export function resetWarnings(): void {
  warningBuffer.length = 0;
}

function outputError(error: Error): void {
  const payload = JSON.stringify({ error: error.message }, null, 2);
  // Write to stdout (same channel as success) so machine callers always
  // receive exactly one parseable JSON object regardless of stream capture.
  logger.info(payload);
  if (process.env.EL_LINEAR_DEBUG) {
    logger.error(error.stack ?? "");
  }
  process.exit(1);
}

export function handleAsyncCommand<TArgs extends unknown[]>(
  asyncFn: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs) => {
    try {
      await asyncFn(...args);
    } catch (error) {
      outputError(error instanceof Error ? error : new Error(String(error)));
    }
  };
}
