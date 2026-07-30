import { describe, expect, it } from "vitest";
import { TimeStringSchema } from "@/domain/schema/time";

describe("TimeStringSchema", () => {
  it("accepts valid HH:MM times", () => {
    expect(TimeStringSchema.safeParse("00:00").success).toBe(true);
    expect(TimeStringSchema.safeParse("09:05").success).toBe(true);
    expect(TimeStringSchema.safeParse("23:59").success).toBe(true);
  });

  it("rejects an hour above 23", () => {
    expect(TimeStringSchema.safeParse("24:00").success).toBe(false);
  });

  it("rejects a minute above 59", () => {
    expect(TimeStringSchema.safeParse("12:60").success).toBe(false);
  });

  it("rejects a missing leading zero", () => {
    expect(TimeStringSchema.safeParse("9:00").success).toBe(false);
  });

  it("rejects a non-time string", () => {
    expect(TimeStringSchema.safeParse("noon").success).toBe(false);
  });
});
