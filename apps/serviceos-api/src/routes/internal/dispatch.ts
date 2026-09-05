import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireInternalToken } from "./provision.js";
import { ingestDispatch } from "../../services/dispatch.js";

const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().optional(),
  region: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
});

async function dispatchHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!requireInternalToken(req.headers.authorization)) {
    return reply.code(401).send({
      error: "unauthorized",
      message: "Valid service bearer token required",
    });
  }

  const body = z
    .object({
      sourceDomain: z.string().optional(),
      tenantId: z.string().optional(),
      orderId: z.string().min(1),
      category: z.enum(["barber", "makeup", "stylist", "massage", "chef", "technician"]).optional(),
      offeringSku: z.string().optional(),
      durationMinutes: z.number().optional(),
      customer: geoSchema,
      priority: z.enum(["standard", "express", "urgent"]).optional(),
      escrowId: z.string().nullable().optional(),
      serviceFee: z.number().optional(),
      serviceFeeMinor: z.number().optional(),
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

  const result = await ingestDispatch(body);
  return reply.code(201).send({
    ...result,
    serviceJobId: result.jobId,
  });
}

export async function registerInternalDispatchRoutes(app: FastifyInstance) {
  app.post("/internal/serviceos/dispatch", dispatchHandler);
  app.post("/internal/services/dispatch", dispatchHandler);
}
