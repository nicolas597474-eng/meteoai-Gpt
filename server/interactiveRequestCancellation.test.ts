import { describe, expect, it, vi } from "vitest";
import { waitForInteractiveRequest } from "./interactiveRequestCancellation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("waitForInteractiveRequest", () => {
  it("rejects an aborted consumer immediately without cancelling the shared promise for another consumer", async () => {
    const shared = deferred<string>();
    const controller = new AbortController();
    const first = waitForInteractiveRequest(shared.promise, controller.signal);
    const second = waitForInteractiveRequest(shared.promise);
    const observed = vi.fn();
    void shared.promise.then(observed);

    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });

    shared.resolve("available for another consumer");
    await expect(second).resolves.toBe("available for another consumer");
    await Promise.resolve();
    expect(observed).toHaveBeenCalledWith("available for another consumer");
  });

  it("rejects without subscribing when the supplied consumer signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(waitForInteractiveRequest(Promise.resolve("late"), controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
