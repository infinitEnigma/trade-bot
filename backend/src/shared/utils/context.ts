/** @format */

import { AsyncLocalStorage } from "async_hooks";
import { randomBytes } from "crypto";

export interface RequestContext {
  correlationId: string;
  userId?: string;
  userLevel?: string;
  startTime: number;
  requestId: string;
  duration?: number;
}

/**
 * AsyncLocalStorage for request context propagation
 */
const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Generate a unique correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return `req_${randomBytes(8).toString("hex")}`;
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `rid_${randomBytes(4).toString("hex")}`;
}

/**
 * Get the current request context
 */
export function getCurrentContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get the current correlation ID
 */
export function getCorrelationId(): string | undefined {
  const context = getCurrentContext();
  return context?.correlationId;
}

/**
 * Get the current user ID
 */
export function getCurrentUserId(): string | undefined {
  const context = getCurrentContext();
  return context?.userId;
}

/**
 * Set the request context for the current async execution
 */
export function setRequestContext(
  context: Partial<RequestContext>
): RequestContext {
  const currentContext = getCurrentContext();
  const newContext: RequestContext = {
    correlationId:
      context.correlationId ||
      currentContext?.correlationId ||
      generateCorrelationId(),
    userId: context.userId || currentContext?.userId,
    userLevel: context.userLevel || currentContext?.userLevel,
    startTime: context.startTime || currentContext?.startTime || Date.now(),
    requestId:
      context.requestId || currentContext?.requestId || generateRequestId(),
  };

  asyncLocalStorage.enterWith(newContext);
  return newContext;
}

/**
 * Run a function with the given request context
 *
 * Uses `AsyncLocalStorage.run` only (never `enterWith`) so the context is
 * scoped to `fn`'s async chain. The previous implementation called
 * `setRequestContext` (which uses `enterWith`) before `run`, leaking the new
 * store into whatever async chain happened to be active — one response was
 * logged under a sibling request's correlationId (L7).
 */
export function runWithContext<T>(
  context: Partial<RequestContext>,
  fn: () => T | Promise<T>
): T | Promise<T> {
  const currentContext = getCurrentContext();
  const ctx: RequestContext = {
    correlationId:
      context.correlationId ||
      currentContext?.correlationId ||
      generateCorrelationId(),
    userId: context.userId ?? currentContext?.userId,
    userLevel: context.userLevel ?? currentContext?.userLevel,
    startTime: context.startTime ?? currentContext?.startTime ?? Date.now(),
    requestId:
      context.requestId || currentContext?.requestId || generateRequestId(),
  };

  return asyncLocalStorage.run(ctx, fn);
}

/**
 * Stable background scopes for long-lived subsystems (L8).
 *
 * Background work (Redis consumer, DB pool, engine protocol, intervals,
 * boot init) must never inherit the boot-wide ambient context nor a request
 * context. Each subsystem gets its own stable correlation id of the form
 * `bg_<subsystem>_<8hex>` so its logs are greppable and `operationDuration`
 * measures time since the scope was created rather than since boot/login.
 */
const backgroundContexts = new Map<string, RequestContext>();

export function getBackgroundContext(subsystem: string): RequestContext {
  const existing = backgroundContexts.get(subsystem);
  if (existing) return existing;
  const ctx: RequestContext = {
    correlationId: `bg_${subsystem}_${randomBytes(4).toString("hex")}`,
    startTime: Date.now(),
    requestId: `bg_${subsystem}`,
  };
  backgroundContexts.set(subsystem, ctx);
  return ctx;
}

/**
 * Run `fn` inside the stable background scope for `subsystem`.
 * Uses `AsyncLocalStorage.run` only — never `enterWith`.
 */
export function runWithBackgroundContext<T>(
  subsystem: string,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return asyncLocalStorage.run(getBackgroundContext(subsystem), fn);
}

/**
 * Clear cached background scopes (tests only).
 */
export function clearBackgroundContextsForTests(): void {
  backgroundContexts.clear();
}

/**
 * Execute a function and ensure it runs within the current context
 */
export function runInContext<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const currentContext = getCurrentContext();
  if (currentContext) {
    return fn();
  }

  // No context, create a new one
  const context = setRequestContext({});
  return asyncLocalStorage.run(context, fn);
}

/**
 * Add context information to logging
 */
export function getContextForLogging(): Record<
  string,
  string | number | undefined
> {
  const context = getCurrentContext();
  if (!context) {
    return {};
  }

  return {
    correlationId: context.correlationId,
    requestId: context.requestId,
    userId: context.userId,
    userLevel: context.userLevel,
    requestDuration: Date.now() - context.startTime,
  };
}

/**
 * Update context with user information
 */
export function setUserContext(userId: string, userLevel?: string): void {
  const context = getCurrentContext();
  if (context) {
    context.userId = userId;
    context.userLevel = userLevel;
  }
}

/**
 * Create a child context for sub-operations
 */
export function createChildContext(operation: string): RequestContext {
  const parentContext = getCurrentContext();
  const childContext: RequestContext = {
    correlationId: parentContext?.correlationId || generateCorrelationId(),
    userId: parentContext?.userId,
    userLevel: parentContext?.userLevel,
    startTime: Date.now(),
    requestId: `${parentContext?.requestId || generateRequestId()}_${operation}`,
  };

  return childContext;
}
