import type { DomainEventMap } from "../shared/events.ts";

export class AuditService {
  async handleUserRegistered(
    payload: DomainEventMap["user.registered"],
  ): Promise<void> {
    console.log(
      `[AuditService] User registered — userId: ${payload.userId}, email: ${payload.email}, at: ${new Date().toISOString()}`,
    );
  }
}
