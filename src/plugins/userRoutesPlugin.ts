/**
 * userRoutesPlugin: Elysia plugin encapsulating all /users route handlers.
 *
 * Route handlers access services via context properties injected by servicesPlugin
 * (userRepo, userService) — no closure over outer variables.
 *
 * Pass the awaited servicesPlugin instance from createServicesPlugin() as argument
 * so TypeScript infers context property types in route handlers (TYPE-01).
 */
import { Elysia } from "elysia";
import type { createServicesPlugin } from "./servicesPlugin.ts";

export function createUserRoutesPlugin(
  services: Awaited<ReturnType<typeof createServicesPlugin>>,
) {
  return new Elysia({ name: "user-routes" })
    .use(services)
    .get("/users", async ({ userRepo }) => {
      return userRepo.findAll();
    })
    .post("/users", async ({ userService, body, set }) => {
      const { email, name } = body as { email: string; name: string };
      try {
        const result = await userService.register(email, name);
        set.status = 201;
        return result;
      } catch (err) {
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "23505"
        ) {
          set.status = 409;
          return { error: "Email already registered" };
        }
        throw err;
      }
    });
}
