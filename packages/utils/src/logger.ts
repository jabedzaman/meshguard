import pino, { type Logger, type TransportTargetOptions } from "pino";

const APP_ENV = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const isDev = APP_ENV === "development";

export type { Logger };

/**
 * Structured logger for a service or module. Pretty-printed in development,
 * JSON to stdout everywhere else.
 *
 * @example const logger = createLogger("api");
 */
export function createLogger(name: string): Logger {
  const target: TransportTargetOptions = isDev
    ? {
        target: "pino-pretty",
        level: LOG_LEVEL,
        options: {
          colorize: true,
          singleLine: true,
          translateTime: "SYS:HH:MM:ss.l",
          // method/path/status/durationMs are already in the request log message.
          ignore: "pid,hostname,app,env,method,path,status,durationMs",
        },
      }
    : { target: "pino/file", level: LOG_LEVEL, options: { destination: 1 } };

  return pino(
    { name, level: LOG_LEVEL, base: { app: name, env: APP_ENV } },
    pino.transport({ targets: [target] }),
  );
}
