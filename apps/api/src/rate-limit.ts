/**
 * A small sliding-window rate limiter.
 *
 * The gateway's interesting cost is not CPU but money and model calls: every
 * submitted request may call the interpreter, and every human action writes
 * to the audit log. A limiter keyed by agent and by caller address keeps one
 * misbehaving client from turning either into a bill or a flood.
 *
 * In-memory, like the rest of the store, and deliberately simple: a sorted
 * list of timestamps per key, pruned on every check.
 */

import type { NextFunction, Request, Response } from 'express';

import { HttpError } from './errors.ts';

export interface LimiterOptions {
  /** Maximum events per key inside the window. */
  limit: number;
  windowMs: number;
}

export interface LimiterVerdict {
  allowed: boolean;
  /** Milliseconds until the oldest counted event leaves the window. */
  retryAfterMs: number;
  remaining: number;
}

export class SlidingWindowLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly hits = new Map<string, number[]>();

  constructor(options: LimiterOptions) {
    this.limit = Math.max(1, Math.floor(options.limit));
    this.windowMs = Math.max(1, Math.floor(options.windowMs));
  }

  check(key: string, now: number = Date.now()): LimiterVerdict {
    const floor = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > floor);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(1, oldest + this.windowMs - now), remaining: 0 };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterMs: 0, remaining: this.limit - recent.length };
  }

  /** Drops keys with no events inside the window. Called opportunistically. */
  prune(now: number = Date.now()): void {
    const floor = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (!times.some((t) => t > floor)) this.hits.delete(key);
    }
  }
}

export interface RateLimitMiddlewareOptions extends LimiterOptions {
  /** Derives the key. Return null to skip limiting for this request. */
  keyOf: (req: Request) => string | null;
  now?: () => Date;
}

/**
 * Express middleware. Answers 429 with a structured error and a Retry-After
 * header, in the same shape as every other gateway error.
 */
export function rateLimit(options: RateLimitMiddlewareOptions) {
  const limiter = new SlidingWindowLimiter(options);
  const now = options.now ?? (() => new Date());
  let checks = 0;

  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = options.keyOf(req);
    if (key === null) return next();

    checks += 1;
    if (checks % 500 === 0) limiter.prune(now().getTime());

    const verdict = limiter.check(key, now().getTime());
    if (verdict.allowed) return next();

    const retryAfterSeconds = Math.ceil(verdict.retryAfterMs / 1000);
    _res.setHeader('Retry-After', String(retryAfterSeconds));
    next(
      new HttpError(
        429,
        'rate_limited',
        `Too many requests. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
      ),
    );
  };
}

/** The caller's address as seen by Express, for per-caller limits. */
export function callerKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
