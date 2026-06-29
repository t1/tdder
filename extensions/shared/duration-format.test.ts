import { describe, expect, it } from "vitest";
import { formatElapsedDuration } from "./duration-format.ts";

describe("formatElapsedDuration", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatElapsedDuration(0)).toBe("0s");
    expect(formatElapsedDuration(59)).toBe("59s");
  });

  it("formats minute durations as minutes and seconds", () => {
    expect(formatElapsedDuration(60)).toBe("1m 0s");
    expect(formatElapsedDuration(61)).toBe("1m 1s");
  });

  it("formats hour durations as hours, minutes, and seconds", () => {
    expect(formatElapsedDuration(3600)).toBe("1h 0m 0s");
    expect(formatElapsedDuration(3603)).toBe("1h 0m 3s");
    expect(formatElapsedDuration(3661)).toBe("1h 1m 1s");
  });

  it("clamps negative durations to zero", () => {
    expect(formatElapsedDuration(-1)).toBe("0s");
  });
});
