import { Logger } from '@nestjs/common';

// Thin wrapper around the Nest logger so that production logs serialise to a
// single JSON line per event (so Railway / Logflare can index them) while dev
// keeps the readable pretty output. Replaces ad-hoc `console.log` peppered
// through the services.
export class AppLogger {
  private readonly log: Logger;

  constructor(context: string) {
    this.log = new Logger(context);
  }

  info(message: string, meta?: Record<string, any>) {
    this.emit('log', message, meta);
  }

  warn(message: string, meta?: Record<string, any>) {
    this.emit('warn', message, meta);
  }

  error(message: string, error?: any, meta?: Record<string, any>) {
    this.emit('error', message, { ...meta, error: serialiseError(error) });
  }

  debug(message: string, meta?: Record<string, any>) {
    this.emit('debug', message, meta);
  }

  private emit(level: 'log' | 'warn' | 'error' | 'debug', message: string, meta?: Record<string, any>) {
    const json = process.env.NODE_ENV === 'production';
    if (json) {
      const payload = { msg: message, ...(meta || {}) };
      try {
        (this.log as any)[level](JSON.stringify(payload));
      } catch {
        (this.log as any)[level](message);
      }
    } else {
      const suffix = meta ? ` ${safeInspect(meta)}` : '';
      (this.log as any)[level](`${message}${suffix}`);
    }
  }
}

function serialiseError(err: any) {
  if (!err) return undefined;
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

function safeInspect(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
