function timestamp() {
  return new Date().toISOString();
}

export function error(context: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(JSON.stringify({ level: "error", timestamp: timestamp(), context, message, stack }));
}

export function warn(context: string, message: string) {
  console.warn(JSON.stringify({ level: "warn", timestamp: timestamp(), context, message }));
}

export function info(context: string, message: string) {
  console.info(JSON.stringify({ level: "info", timestamp: timestamp(), context, message }));
}

export const logger = { error, warn, info };
