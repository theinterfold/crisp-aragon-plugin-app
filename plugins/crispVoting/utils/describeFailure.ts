/**
 * Turns a thrown transaction error into something worth showing a user.
 *
 * Returns `undefined` for a declined signature: `useTransactionManager` already raises its own
 * alert for that, and it is a deliberate choice rather than a failure to report twice.
 *
 * @param err The caught error.
 * @param fallback Message to use when the error carries nothing readable.
 */
export function describeFailure(err: unknown, fallback: string): string | undefined {
  const message = (err as { shortMessage?: string })?.shortMessage ?? (err as Error)?.message ?? fallback;

  if (/user rejected/i.test(message)) return undefined;

  return message;
}
