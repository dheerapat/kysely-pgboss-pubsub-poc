import { describe, it, expect, spyOn } from "bun:test";
import { NotificationService } from "./NotificationService.ts";

describe("NotificationService", () => {
  it("handleUserRegistered logs a welcome email message with email and userId", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    const service = new NotificationService();
    await service.handleUserRegistered({
      userId: "u1",
      email: "alice@test.com",
      name: "Alice",
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = consoleSpy.mock.calls[0]?.[0] as string;
    expect(logged).toContain("alice@test.com");
    expect(logged).toContain("u1");

    consoleSpy.mockRestore();
  });

  it("handleUserRegistered returns Promise<void>", async () => {
    const service = new NotificationService();
    const result = service.handleUserRegistered({
      userId: "u2",
      email: "bob@test.com",
      name: "Bob",
    });
    expect(result).toBeInstanceOf(Promise);
    await result;
  });
});
