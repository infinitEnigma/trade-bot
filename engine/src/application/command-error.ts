/**
 * Command Error
 *
 * Carries the distinction between a business failure and a transient
 * infrastructure failure so the Redis command consumer can decide whether a
 * command key should be ACKed (business outcome already reached, e.g.
 * COMMAND_FAILED published) or left pending for retry (transient outage).
 *
 * @format
 */

export class CommandError extends Error {
    readonly retryable: boolean;

    constructor(retryable: boolean, message: string) {
        super(message);
    this.name = "CommandError";
        this.retryable = retryable;
    }
}