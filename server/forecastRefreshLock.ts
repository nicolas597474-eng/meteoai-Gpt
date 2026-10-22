export const FORECAST_REFRESH_LOCK_LEASE_MS = 5 * 60_000;
export const FAVORITES_FORECAST_SCHEDULER_LOCK_KEY = "favorites-forecast-scheduler";
export const FORECAST_REFRESH_LOCK_RENEWAL_MS = Math.floor(FORECAST_REFRESH_LOCK_LEASE_MS / 3);
const FORECAST_REFRESH_LOCK_KEY_MAX_LENGTH = 64;
const PHYSICAL_SNAPSHOT_LOCK_KEY_PREFIX = "physical-snapshot:";

export function getLocationForecastRefreshLockKey(locationKey: string): string {
  return `forecast-location:${locationKey}`;
}

/**
 * La clé physique doit rester dans forecast_refresh_locks.lockKey varchar(64).
 * 18 (préfixe) + 32 (locationKey) + 1 + 10 (date) + 1 + 2 (heure) = 64.
 */
export function getPhysicalSnapshotLeaseLockKey(locationKey: string, dateParis: string, hourParis: number): string {
  if (locationKey.length > 32) throw new RangeError("Physical snapshot locationKey exceeds 32 characters.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParis)) throw new RangeError("Physical snapshot date must be YYYY-MM-DD.");
  if (!Number.isInteger(hourParis) || hourParis < 0 || hourParis > 23) {
    throw new RangeError("Physical snapshot hour must be an integer from 0 to 23.");
  }
  const lockKey = `${PHYSICAL_SNAPSHOT_LOCK_KEY_PREFIX}${locationKey}:${dateParis}:${String(hourParis).padStart(2, "0")}`;
  if (lockKey.length > FORECAST_REFRESH_LOCK_KEY_MAX_LENGTH) {
    throw new RangeError("Physical snapshot lease lock key exceeds 64 characters.");
  }
  return lockKey;
}

export function getObservationScoringLeaseLockKey(dateParis: string): string {
  return `observation-scoring:${dateParis}`;
}

/** Adapter atomique fourni par la base de données ou par un test. */
export type ForecastLeaseStore = {
  insertIfAbsent: (input: { lockKey: string; ownerToken: string; leaseExpiresAt: Date }) => Promise<boolean>;
  claimIfExpired: (input: { lockKey: string; ownerToken: string; now: Date; leaseExpiresAt: Date }) => Promise<boolean>;
  renewIfOwned: (input: { lockKey: string; ownerToken: string; now: Date; leaseExpiresAt: Date }) => Promise<boolean>;
};

export type ScheduledForecastJobDisposition = "already-completed" | "in-progress" | "retry";

export function decideScheduledForecastJobDisposition(
  existing: { status: string; startedAt: Date | string | null | undefined },
  now = new Date(),
  leaseMs = FORECAST_REFRESH_LOCK_LEASE_MS,
): ScheduledForecastJobDisposition {
  if (existing.status === "completed") return "already-completed";
  if (existing.status !== "running") return "retry";
  const startedAtMs = existing.startedAt instanceof Date
    ? existing.startedAt.getTime()
    : existing.startedAt == null ? NaN : new Date(existing.startedAt).getTime();
  if (!Number.isFinite(startedAtMs) || startedAtMs > now.getTime() - leaseMs) return "in-progress";
  return "retry";
}

/**
 * Acquiert ou reprend un lease arrivé à expiration. La sûreté concurrente vient
 * de l'unicité de lockKey et du compare-and-set de l'adaptateur persistant.
 */
export async function acquireForecastLease(
  store: ForecastLeaseStore,
  input: { lockKey: string; ownerToken: string; now?: Date; leaseMs?: number },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? FORECAST_REFRESH_LOCK_LEASE_MS));
  if (await store.insertIfAbsent({ lockKey: input.lockKey, ownerToken: input.ownerToken, leaseExpiresAt })) return true;
  return store.claimIfExpired({ lockKey: input.lockKey, ownerToken: input.ownerToken, now, leaseExpiresAt });
}

/**
 * Renouvelle uniquement un lease encore détenu et non expiré. Un propriétaire
 * périmé ne peut donc jamais « ressusciter » son lease après qu'une reprise a
 * pu le réclamer.
 */
export async function renewForecastLease(
  store: ForecastLeaseStore,
  input: { lockKey: string; ownerToken: string; now?: Date; leaseMs?: number },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? FORECAST_REFRESH_LOCK_LEASE_MS));
  return store.renewIfOwned({ lockKey: input.lockKey, ownerToken: input.ownerToken, now, leaseExpiresAt });
}

export type ForecastLeaseRenewal = {
  renewNow: () => Promise<boolean>;
  assertHeld: () => void;
  stop: () => void;
};

/**
 * Watchdog local d'un lease persistant. Il ne jette jamais une promesse de
 * timer non gérée : la perte du lease est mémorisée et le détenteur doit
 * s'arrêter au prochain point de contrôle via assertHeld().
 */
export function startForecastLeaseRenewal(
  renew: () => Promise<boolean>,
  options: { leaseMs?: number; renewalMs?: number } = {},
): ForecastLeaseRenewal {
  const leaseMs = options.leaseMs ?? FORECAST_REFRESH_LOCK_LEASE_MS;
  const renewalMs = options.renewalMs ?? Math.max(1_000, Math.floor(leaseMs / 3));
  let stopped = false;
  let held = true;
  let renewalInFlight: Promise<boolean> | null = null;

  const renewNow = async (): Promise<boolean> => {
    if (stopped || !held) return held;
    if (!renewalInFlight) {
      renewalInFlight = renew()
        .then((renewed) => {
          held = renewed;
          return renewed;
        })
        .catch(() => {
          held = false;
          return false;
        })
        .finally(() => {
          renewalInFlight = null;
        });
    }
    return renewalInFlight;
  };
  // Ce watchdog ne sert qu'à une invocation HTTP déjà en cours : il n'est ni un
  // scheduler autonome ni une raison de garder un processus éphémère vivant.
  const timer = setInterval(() => { void renewNow(); }, renewalMs);
  timer.unref?.();

  return {
    renewNow,
    assertHeld() {
      if (!held) throw new Error("Lease de collecte perdu pendant l'exécution.");
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
