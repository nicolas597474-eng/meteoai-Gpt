import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  acquireForecastLease,
  decideScheduledForecastJobDisposition,
  FORECAST_REFRESH_LOCK_LEASE_MS,
  getPhysicalSnapshotLeaseLockKey,
  renewForecastLease,
  startForecastLeaseRenewal,
  type ForecastLeaseStore,
} from "./forecastRefreshLock";

type Lease = { ownerToken: string; leaseExpiresAt: Date };
function memoryStore(initial: Record<string, Lease> = {}) {
  const leases = new Map(Object.entries(initial));
  const store: ForecastLeaseStore = {
    async insertIfAbsent({ lockKey, ownerToken, leaseExpiresAt }) {
      if (leases.has(lockKey)) return false;
      leases.set(lockKey, { ownerToken, leaseExpiresAt });
      return true;
    },
    async claimIfExpired({ lockKey, ownerToken, now, leaseExpiresAt }) {
      const current = leases.get(lockKey);
      if (!current || current.leaseExpiresAt.getTime() > now.getTime()) return false;
      leases.set(lockKey, { ownerToken, leaseExpiresAt });
      return true;
    },
    async renewIfOwned({ lockKey, ownerToken, now, leaseExpiresAt }) {
      const current = leases.get(lockKey);
      if (!current || current.ownerToken !== ownerToken || current.leaseExpiresAt.getTime() <= now.getTime()) return false;
      leases.set(lockKey, { ownerToken, leaseExpiresAt });
      return true;
    },
  };
  return { store, leases };
}

describe("leases distribués du refresh prévision", () => {
  it("n’accorde qu’un propriétaire au milieu de deux claims concurrents", async () => {
    const { store, leases } = memoryStore();
    const now = new Date("2026-09-30T08:00:00.000Z");
    const results = await Promise.all([
      acquireForecastLease(store, { lockKey: "forecast-location:1,2", ownerToken: "a", now }),
      acquireForecastLease(store, { lockKey: "forecast-location:1,2", ownerToken: "b", now }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(leases.get("forecast-location:1,2")?.leaseExpiresAt.getTime()).toBe(now.getTime() + FORECAST_REFRESH_LOCK_LEASE_MS);
  });

  it("permet de reprendre une lease expirée par compare-and-set", async () => {
    const oldNow = new Date("2026-09-30T08:00:00.000Z");
    const newNow = new Date(oldNow.getTime() + FORECAST_REFRESH_LOCK_LEASE_MS + 1);
    const { store, leases } = memoryStore({
      "favorites-forecast-scheduler": {
        ownerToken: "abandoned",
        leaseExpiresAt: new Date(oldNow.getTime() + FORECAST_REFRESH_LOCK_LEASE_MS),
      },
    });
    expect(await acquireForecastLease(store, {
      lockKey: "favorites-forecast-scheduler",
      ownerToken: "recovery",
      now: newNow,
    })).toBe(true);
    expect(leases.get("favorites-forecast-scheduler")?.ownerToken).toBe("recovery");
  });

  it("ignore une deuxième demande tant que le lease est valide", async () => {
    const now = new Date("2026-09-30T08:00:00.000Z");
    const { store } = memoryStore({
      "favorites-forecast-scheduler": {
        ownerToken: "first",
        leaseExpiresAt: new Date(now.getTime() + 1_000),
      },
    });
    expect(await acquireForecastLease(store, {
      lockKey: "favorites-forecast-scheduler",
      ownerToken: "second",
      now,
    })).toBe(false);
  });

  it("renouvelle seulement le lease vivant détenu par son propriétaire", async () => {
    const acquiredAt = new Date("2026-09-30T08:00:00.000Z");
    const renewAt = new Date(acquiredAt.getTime() + 60_000);
    const { store, leases } = memoryStore({
      "forecast-location:50.756_2.521": {
        ownerToken: "owner-a",
        leaseExpiresAt: new Date(acquiredAt.getTime() + FORECAST_REFRESH_LOCK_LEASE_MS),
      },
    });

    await expect(renewForecastLease(store, {
      lockKey: "forecast-location:50.756_2.521",
      ownerToken: "owner-a",
      now: renewAt,
    })).resolves.toBe(true);
    expect(leases.get("forecast-location:50.756_2.521")?.leaseExpiresAt.getTime())
      .toBe(renewAt.getTime() + FORECAST_REFRESH_LOCK_LEASE_MS);

    await expect(renewForecastLease(store, {
      lockKey: "forecast-location:50.756_2.521",
      ownerToken: "owner-b",
      now: renewAt,
    })).resolves.toBe(false);
  });

  it("refuse de ressusciter le lease expiré de son ancien propriétaire", async () => {
    const expiredAt = new Date("2026-09-30T08:00:00.000Z");
    const { store } = memoryStore({
      "forecast-location:50.756_2.521": { ownerToken: "abandoned", leaseExpiresAt: expiredAt },
    });
    await expect(renewForecastLease(store, {
      lockKey: "forecast-location:50.756_2.521",
      ownerToken: "abandoned",
      now: new Date(expiredAt.getTime() + 1),
    })).resolves.toBe(false);
  });
});

describe("clé et watchdog de lease physique", () => {
  it("construit exactement 64 caractères pour un locationKey de 32 caractères", () => {
    const locationKey = "x".repeat(32);
    const key = getPhysicalSnapshotLeaseLockKey(locationKey, "2026-10-12", 3);
    expect(key).toBe(`physical-snapshot:${locationKey}:2026-10-12:03`);
    expect(key).toHaveLength(64);
    expect(() => getPhysicalSnapshotLeaseLockKey("x".repeat(33), "2026-10-12", 3)).toThrow(RangeError);
    expect(() => getPhysicalSnapshotLeaseLockKey(locationKey, "12-10-2026", 3)).toThrow(RangeError);
    expect(() => getPhysicalSnapshotLeaseLockKey(locationKey, "2026-10-12", 24)).toThrow(RangeError);
  });

  it("unref le watchdog local et l'arrête sans lancer de renouvellement additionnel", async () => {
    const timer = { unref: vi.fn() } as any;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockReturnValue(timer);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    const renew = vi.fn().mockResolvedValue(true);
    try {
      const watchdog = startForecastLeaseRenewal(renew, { renewalMs: 1_000 });
      expect(timer.unref).toHaveBeenCalledOnce();
      await expect(watchdog.renewNow()).resolves.toBe(true);
      expect(renew).toHaveBeenCalledOnce();

      watchdog.stop();
      await expect(watchdog.renewNow()).resolves.toBe(true);
      expect(renew).toHaveBeenCalledOnce();
      expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});

describe("idempotence des slots de collecte", () => {
  const now = new Date("2026-09-30T08:00:00.000Z");

  it("ne relance pas un lot terminé, y compris un lot partiel déjà observé", () => {
    expect(decideScheduledForecastJobDisposition({ status: "completed", startedAt: now }, now)).toBe("already-completed");
  });

  it("évite un chevauchement de job récent, mais autorise la reprise d’un run échoué ou obsolète", () => {
    expect(decideScheduledForecastJobDisposition({ status: "running", startedAt: now }, now)).toBe("in-progress");
    expect(decideScheduledForecastJobDisposition({ status: "failed", startedAt: now }, now)).toBe("retry");
    expect(decideScheduledForecastJobDisposition({
      status: "running",
      startedAt: new Date(now.getTime() - FORECAST_REFRESH_LOCK_LEASE_MS - 1),
    }, now)).toBe("retry");
    expect(decideScheduledForecastJobDisposition({ status: "running", startedAt: null }, now)).toBe("in-progress");
  });

  it("déclare l’unicité du slot et des leases dans le schéma MySQL", () => {
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    const database = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    expect(schema).toContain('uniqueIndex("collection_jobs_schedule_run_key_unique").on(table.scheduleRunKey)');
    expect(schema).toContain('mysqlTable("forecast_refresh_locks"');
    expect(schema).toContain('lockKey: varchar("lockKey", { length: 64 }).primaryKey()');
    expect(database).toContain('eq(collectionJobs.jobType, "forecast"), isNotNull(collectionJobs.scheduleRunKey)');
  });
});
