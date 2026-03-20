import { describe, it, expect } from "bun:test";
import { Email } from "./Email.ts";

describe("Email", () => {
  it("creates an Email from a valid address", () => {
    const addr = "user@example.com";
    const email = Email.create(addr);
    expect(email as string).toBe(addr);
  });

  it("throws Error for a string with no '@'", () => {
    expect(() => Email.create("notanemail")).toThrow("Invalid email format");
  });

  it("throws Error for a string with '@' but no '.' after it", () => {
    expect(() => Email.create("missing@dot")).toThrow("Invalid email format");
  });

  it("throws Error when '@' is the first character (nothing before it)", () => {
    expect(() => Email.create("@example.com")).toThrow("Invalid email format");
  });

  it("returns the original string value after successful creation", () => {
    const addr = "valid@example.com";
    const email = Email.create(addr);
    expect(typeof email).toBe("string");
  });
});
