import { describe, it, expect } from "bun:test";
import { UserId } from "./UserId.ts";

describe("UserId", () => {
  it("creates a UserId from a string and returns the same value via .value", () => {
    const raw = "123e4567-e89b-12d3-a456-426614174000";
    const id = UserId.create(raw);
    // Accessing the underlying value — UserId is a branded string so it IS the string
    expect(id as string).toBe(raw);
  });

  it("UserId is type-compatible with string for value access", () => {
    const raw = "abc-uuid";
    const id = UserId.create(raw);
    expect(typeof id).toBe("string");
  });
});
