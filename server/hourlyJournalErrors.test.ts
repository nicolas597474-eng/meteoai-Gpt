import { describe, expect, it } from "vitest";
import { formatHourlyJournalWriteError } from "./hourlyJournalErrors";

describe("formatHourlyJournalWriteError", () => {
  it("expose le message MySQL, son code, SQLSTATE et la colonne fautive depuis une cause imbriquée", () => {
    const driverError = Object.assign(
      new Error("Data too long for column 'errorCode' at row 1"),
      {
        code: "ER_DATA_TOO_LONG",
        errno: 1406,
        sqlState: "22001",
        sqlMessage: "Data too long for column 'errorCode' at row 1",
      },
    );
    const wrappedError = new Error("Drizzle query failed", { cause: driverError });

    expect(formatHourlyJournalWriteError(wrappedError)).toBe(
      'message="Data too long for column \'errorCode\' at row 1"; code=ER_DATA_TOO_LONG; constraint="column `errorCode` (no named SQL constraint)"; errno=1406; sqlState=22001',
    );
  });

  it("préserve le nom d’une clé unique fournie par le pilote", () => {
    const error = Object.assign(new Error("Duplicate entry for key 'hourly_collection_attempt_source_unique'"), {
      code: "ER_DUP_ENTRY",
      constraintName: "hourly_collection_attempt_source_unique",
    });

    const formatted = formatHourlyJournalWriteError(error);
    expect(formatted).toContain("code=ER_DUP_ENTRY");
    expect(formatted).toContain('constraint="hourly_collection_attempt_source_unique"');
  });

  it("reste utilisable pour une erreur non SQL sans métadonnées", () => {
    const formatted = formatHourlyJournalWriteError("journal unavailable");
    expect(formatted).toContain('message="journal unavailable"');
    expect(formatted).toContain("code=unknown");
    expect(formatted).toContain('constraint="not reported by database driver"');
  });
});
