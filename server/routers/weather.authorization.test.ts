import { describe, expect, it } from "vitest";
import { weatherRouter } from "./weather";
import type { TrpcContext } from "../_core/context";

function context(role: "user" | null): TrpcContext {
 const user = role ? { id: 991, openId: "test-only", role, name: "Test", email: null, loginMethod: "test", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } : null;
 return { user, req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("weather admin authorization before side effects", () => {
 for (const role of [null, "user"] as const) {
  it(`rejects ${role ?? "anonymous"} for every admin operation`, async () => {
   const caller = weatherRouter.createCaller(context(role));
   const operations = [
    () => caller.triggerCollection({ type: "forecast" }),
    () => caller.triggerCollection({ type: "observation" }),
    () => caller.getJobs(),
    () => caller.getLocalNowcastingReports(),
    () => caller.compareHondeghemAromeShadow(),
    () => caller.verifyHondeghemAromeWindDirection(),
    () => caller.compareOpenWeatherShadow(),
   ];
   for (const operation of operations) await expect(operation()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
 }
});
