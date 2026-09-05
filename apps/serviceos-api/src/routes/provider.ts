import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { httpError } from "../lib/crypto.js";
import { pingProviderLocation, setProviderDuty } from "../services/providers.js";
import { acceptJob, advanceJob, declineJob, publicJobView } from "../services/dispatch.js";
import { formatMinor } from "@serviceos/shared";

function providerIdFrom(req: { headers: Record<string, unknown>; body?: unknown; query?: unknown }): string {
  const header = req.headers["x-provider-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const body = req.body as { providerId?: string } | undefined;
  if (body?.providerId) return body.providerId;
  const query = req.query as { providerId?: string } | undefined;
  if (query?.providerId) return query.providerId;
  throw httpError(401, "unauthorized", "x-provider-id header or providerId is required");
}

export async function registerProviderRoutes(app: FastifyInstance) {
  app.post("/v1/provider/login", async (req, reply) => {
    const body = z.object({ code: z.string().min(1), tenantSlug: z.string().optional() }).parse(req.body);
    const provider = await prisma.provider.findFirst({
      where: {
        code: body.code,
        ...(body.tenantSlug ? { tenant: { slug: body.tenantSlug } } : {}),
      },
    });
    if (!provider) return reply.code(404).send({ error: "not_found", message: "Provider not found" });
    return { provider, token: provider.id };
  });

  app.get("/v1/providers", async () => {
    const providers = await prisma.provider.findMany({ orderBy: { displayName: "asc" } });
    return { providers };
  });

  app.get("/v1/provider/me", async (req) => {
    const providerId = providerIdFrom(req);
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw httpError(404, "not_found", "Provider not found");
    return { provider };
  });

  app.post("/v1/provider/duty", async (req) => {
    const providerId = providerIdFrom(req);
    const body = z.object({ online: z.boolean(), providerId: z.string().optional() }).parse(req.body);
    const provider = await setProviderDuty({ providerId, online: body.online });
    return { provider };
  });

  app.post("/v1/provider/location", async (req, reply) => {
    const body = z
      .object({
        providerId: z.string().min(1),
        lat: z.number(),
        lng: z.number(),
      })
      .parse(req.body);
    const result = await pingProviderLocation(body);
    return reply.code(200).send({
      ok: true,
      provider: {
        id: result.provider.id,
        lat: result.provider.lat,
        lng: result.provider.lng,
        status: result.provider.status,
      },
      job: result.job
        ? {
            jobId: result.job.id,
            status: result.job.status,
            etaMinutes: result.job.etaMinutes,
            lastEtaMinutes: result.job.lastEtaMinutes,
          }
        : null,
    });
  });

  app.get("/v1/provider/offer", async (req) => {
    const providerId = providerIdFrom(req);
    const job = await prisma.serviceJob.findFirst({
      where: { offeredProviderId: providerId, status: "OFFERED" },
      include: { provider: true },
    });
    if (!job) return { offer: null };
    return {
      offer: {
        ...publicJobView(job),
        earningsMinor: job.providerPayoutMinor,
        earningsFormatted: formatMinor(job.providerPayoutMinor, job.currency),
        offerExpiresAt: job.offerExpiresAt,
      },
    };
  });

  app.get("/v1/provider/active-job", async (req) => {
    const providerId = providerIdFrom(req);
    const job = await prisma.serviceJob.findFirst({
      where: {
        providerId,
        status: { in: ["ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_SERVICE"] },
      },
      include: { provider: true },
    });
    if (!job) return { job: null };
    return {
      job: {
        ...publicJobView(job),
        navUrl: `https://maps.google.com/?daddr=${job.customerLat},${job.customerLng}`,
      },
    };
  });

  app.post("/v1/jobs/:jobId/accept", async (req) => {
    const providerId = providerIdFrom(req);
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params);
    const job = await acceptJob(jobId, providerId);
    return { job };
  });

  app.post("/v1/jobs/:jobId/decline", async (req) => {
    const providerId = providerIdFrom(req);
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params);
    const job = await declineJob(jobId, providerId);
    return { job };
  });

  app.post("/v1/jobs/:jobId/advance", async (req) => {
    const providerId = providerIdFrom(req);
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params);
    const body = z
      .object({
        action: z.enum(["start_navigation", "arrive", "start_service"]).optional(),
        providerId: z.string().optional(),
      })
      .parse(req.body ?? {});
    const job = await advanceJob(jobId, providerId, body.action);
    return { job };
  });
}
