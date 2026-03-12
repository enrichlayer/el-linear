import { logger } from "./logger.js";

export function outputSuccess(data: unknown): void {
  logger.info(JSON.stringify(data, null, 2));
}

export function outputWarning(message: string | string[], type?: string): void {
  const payload = Array.isArray(message)
    ? { warnings: message, ...(type ? { type } : {}) }
    : { warning: message, ...(type ? { type } : {}) };
  logger.error(JSON.stringify(payload));
}

function outputError(error: Error): void {
  logger.error(JSON.stringify({ error: error.message }, null, 2));
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
