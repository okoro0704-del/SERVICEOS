import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { httpError } from "../lib/crypto.js";
import { publicJobView } from "../services/dispatch.js";
import { getLifeOsMessagingProvider } from "../services/lifeos/container.js";
import { appointmentsPageHtml, catalogPageHtml, trackPageHtml } from "../web/pages.js";

export async function registerTrackRoutes(app: FastifyInstance) {
  app.get("/v1/track/:jobId", async (req) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params);
    const job = await prisma.serviceJob.findUnique({ where: { id: jobId }, include: { provider: true } });
    if (!job) throw httpError(404, "not_found", "Job not found");

    const messaging = getLifeOsMessagingProvider();
    const messages = messaging.listMessages ? await messaging.listMessages(jobId) : [];

    return {
      ...publicJobView(job),
      otpDisplay: job.otpCode.split(""),
      provider: job.provider
        ? {
            id: job.provider.id,
            displayName: job.provider.displayName,
            skill: job.provider.skill,
            lat: job.provider.lat,
            lng: job.provider.lng,
            lastPingAt: job.provider.lastPingAt,
          }
        : null,
      messages,
    };
  });

  app.get("/v1/catalog", async (req) => {
    const query = z.object({ tenantId: z.string().optional() }).parse(req.query);
    const offerings = await prisma.serviceOffering.findMany({
      where: query.tenantId ? { tenantId: query.tenantId } : {},
      orderBy: { name: "asc" },
    });
    return { offerings };
  });

  app.get("/embed/catalog", async (req, reply) => {
    const query = z.object({ tenantId: z.string().optional() }).parse(req.query);
    const tenant = query.tenantId
      ? await prisma.tenant.findFirst({ where: { OR: [{ id: query.tenantId }, { slug: query.tenantId }] } })
      : await prisma.tenant.findFirst({ where: { status: "active" }, orderBy: { createdAt: "asc" } });
    const studio = tenant ? await prisma.studioConfig.findUnique({ where: { tenantId: tenant.id } }) : null;
    return reply.type("text/html").send(
      catalogPageHtml({ tenantId: tenant?.id ?? "", preset: studio?.preset ?? "beauty" }),
    );
  });

  app.get("/embed/appointments", async (req, reply) => {
    const query = z.object({ tenantId: z.string().optional() }).parse(req.query);
    const jobs = await prisma.serviceJob.findMany({
      where: query.tenantId ? { tenantId: query.tenantId } : {},
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    return reply.type("text/html").send(
      appointmentsPageHtml(
        jobs.map((j) => ({
          id: j.id,
          status: j.status,
          category: j.category,
          customerAddressLine1: j.customerAddressLine1,
        })),
      ),
    );
  });

  app.get("/track/booking/:bookingId", async (req, reply) => {
    const { bookingId } = z.object({ bookingId: z.string() }).parse(req.params);
    const job = await prisma.serviceJob.findUnique({ where: { id: bookingId }, include: { provider: true } });
    if (!job) throw httpError(404, "not_found", "Booking not found");
    const messaging = getLifeOsMessagingProvider();
    const messages = messaging.listMessages ? await messaging.listMessages(bookingId) : [];
    return reply.type("text/html").send(
      trackPageHtml({
        id: job.id,
        otpCode: job.otpCode,
        etaMinutes: job.etaMinutes,
        customerLat: job.customerLat,
        customerLng: job.customerLng,
        provider: job.provider
          ? { lat: job.provider.lat, lng: job.provider.lng, displayName: job.provider.displayName }
          : null,
        messages: messages.map((m) => ({ messageId: m.messageId, body: m.body })),
      }),
    );
  });
}
