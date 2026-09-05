import type { FastifyInstance } from "fastify";
import { registerInternalProvisionRoutes } from "./routes/internal/provision.js";
import { registerInternalDispatchRoutes } from "./routes/internal/dispatch.js";
import { registerProviderRoutes } from "./routes/provider.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerBookingRoutes } from "./routes/bookings.js";
import { registerTrackRoutes } from "./routes/track.js";
import { config } from "./config.js";
import { assertLifeOsPrimitivesReady, getLifeOsPrimitives } from "./services/lifeos/container.js";
import { SERVICEOS_MANIFEST } from "@serviceos/shared";

export async function registerRoutes(app: FastifyInstance) {
  await registerInternalProvisionRoutes(app);
  await registerInternalDispatchRoutes(app);
  await registerProviderRoutes(app);
  await registerJobRoutes(app);
  await registerBookingRoutes(app);
  await registerTrackRoutes(app);

  app.get("/", async () => ({
    status: "ok" as const,
    service: "serviceos-api" as const,
    version: config.version,
    provider: "http://localhost:5194",
    health: "/health",
    primitives: "/health/primitives",
  }));

  app.get("/health", async () => ({
    status: "ok" as const,
    service: "serviceos-api" as const,
    version: config.version,
    time: new Date().toISOString(),
  }));

  app.get("/health/primitives", async () => {
    const ready = await assertLifeOsPrimitivesReady();
    const c = getLifeOsPrimitives();
    return {
      ok: ready.ok,
      count: ready.count,
      ids: ready.ids,
      health: {
        trustId: await c.trustId.health(),
        messaging: await c.messaging.health(),
        storage: await c.storage.health(),
        jobs: await c.jobs.health(),
        distributor: await c.distributor.health(),
        wallet: await c.wallet.health(),
      },
    };
  });

  app.get("/.well-known/serviceos-manifest", async () => SERVICEOS_MANIFEST);
}
