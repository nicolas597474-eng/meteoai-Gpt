import { describe, expect, it } from "vitest";
import { HISTORY_DETAILS_TABLE_CLASS } from "./historyLayout";

describe("HISTORY_DETAILS_TABLE_CLASS", () => {
  it("préserve une largeur lisible sans retirer de colonne", () => {
    expect(HISTORY_DETAILS_TABLE_CLASS).toContain("min-w-[760px]");
    expect(HISTORY_DETAILS_TABLE_CLASS).toContain("w-full");
  });
});
