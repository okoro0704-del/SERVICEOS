import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { httpError } from "../lib/crypto.js";
import { createCustomerBooking, quoteBooking } from "../services/bookings.js";

const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  accessNotes: z.string().nullable().optional(),
  gateCode: z.string().nullable().optional(),
});

export async function registerBookingRoutes(app: FastifyInstance) {
  app.post("/v1/bookings/quote", async (req) => {
    const body = z
      .object({
        tenantId: z.string().optional(),
        offeringSku: z.string().optional(),
        category: z.enum(["barber", "makeup", "stylist", "massage", "chef", "technician"]).optional(),
        lat: z.number(),
        lng: z.number(),
      })
      .parse(req.body);
    return quoteBooking(body);
  });

  app.post("/v1/bookings", async (req, reply) => {
    const body = z
      .object({
        tenantId: z.string().optional(),
        offeringSku: z.string().optional(),
        category: z.enum(["barber", "makeup", "stylist", "massage", "chef", "technician"]).optional(),
        scheduleMode: z.enum(["asap", "slot"]).optional(),
        scheduledAt: z.string().nullable().optional(),
        customer: geoSchema,
        buyer: z
          .object({
            trustId: z.string().optional(),
            name: z.string().optional(),
            phone: z.string().nullable().optional(),
            email: z.string().nullable().optional(),
          })
          .optional(),
      })
      .parse(req.body);
    const result = await createCustomerBooking(body);
    return reply.code(201).send(result);
  });

  app.get("/v1/bookings/:bookingId", async (req, reply) => {
    const { bookingId } = z.object({ bookingId: z.string() }).parse(req.params);
    return reply.redirect(`/v1/track/${bookingId}`);
  });

  app.get("/v1/dispatches/active", async (req) => {
    const query = z.object({ tenantId: z.string().optional() }).parse(req.query);
    const jobs = await prisma.serviceJob.findMany({
      where: {
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        status: { in: ["OFFERED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_SERVICE"] },
      },
      include: { provider: true },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });
    return {
      jobs: jobs.map((job) => ({
        jobId: job.id,
        bookingId: job.id,
        status: job.status,
        category: job.category,
        etaMinutes: job.etaMinutes,
        customer: { lat: job.customerLat, lng: job.customerLng, addressLine1: job.customerAddressLine1 },
        provider: job.provider
          ? { id: job.provider.id, displayName: job.provider.displayName, lat: job.provider.lat, lng: job.provider.lng }
          : null,
      })),
    };
  });
}
