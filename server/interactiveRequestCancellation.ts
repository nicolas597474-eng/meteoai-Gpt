/**
 * Lets one HTTP consumer stop waiting without cancelling a bounded shared
 * single-flight operation that may still serve other consumers.
 */
export function createConsumerAbortError(): DOMException {
  return new DOMException("The interactive weather request was cancelled by its consumer.", "AbortError");
}

/**
 * Race only the caller's wait against its AbortSignal. The shared promise is
 * observed but never cancelled or otherwise mutated by this helper.
 */
export function waitForInteractiveRequest<T>(shared: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(createConsumerAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(createConsumerAbortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    void shared.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
