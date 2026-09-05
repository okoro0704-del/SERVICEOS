import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { config } from "../../config.js";
import { provisionServiceTenant } from "../../services/distributor/provision-tenant.js";

function bearerEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireInternalToken(authHeader: string | undefined): boolean {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return false;
  return bearerEquals(token, config.internalProvisionToken);
}

export async function registerInternalProvisionRoutes(app: FastifyInstance) {
  app.post("/internal/distributor/provision", async (req, reply) => {
    if (!requireInternalToken(req.headers.authorization)) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Valid service bearer token required",
      });
    }

    const body = z
      .object({
        distributorTenantId: z.string().min(1).optional(),
        tenantId: z.string().min(1).optional(),
        subdomain: z.string().min(1).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i),
        slug: z.string().min(1).optional(),
        displayName: z.string().min(1),
        customDomain: z.string().optional(),
        brand: z
          .object({
            primaryColor: z.string().optional(),
            logoUrl: z.string().url().optional(),
          })
          .optional(),
        oauthDestinations: z.array(z.string()).optional(),
        modules: z.array(z.string()).optional(),
        seed: z.enum(["default", "none"]).optional(),
        trustId: z
          .object({
            audience: z.string().optional(),
            businessPublicId: z.string().optional(),
          })
          .optional(),
        organization: z
          .object({
            slug: z.string().optional(),
            name: z.string().optional(),
          })
          .optional(),
        manifestVersion: z.string().optional(),
        hq: z
          .object({
            addressLine1: z.string().optional(),
            city: z.string().optional(),
            country: z.string().optional(),
            lat: z.number().optional(),
            lng: z.number().optional(),
          })
          .optional(),
        defaultCurrency: z.string().optional(),
        tariffs: z
          .object({
            basePriceMinor: z.number().optional(),
            perKmFeeMinor: z.number().optional(),
            platformCommissionBps: z.number().optional(),
            categoryMultipliers: z.record(z.number()).optional(),
          })
          .optional(),
        preset: z.enum(["beauty", "wellness", "technical", "culinary"]).optional(),
        studioSettings: z
          .object({
            cancellationWindowMinutes: z.number().int().min(0).optional(),
            requireSkillCertifications: z.boolean().optional(),
            requireProofOfServicePhoto: z.boolean().optional(),
          })
          .optional(),
      })
      .refine((v) => Boolean(v.distributorTenantId ?? v.tenantId), {
        message: "distributorTenantId or tenantId is required",
      })
      .parse(req.body);

    try {
      const result = await provisionServiceTenant({
        distributorTenantId: body.distributorTenantId ?? body.tenantId!,
        tenantId: body.tenantId,
        subdomain: body.subdomain,
        slug: body.slug,
        displayName: body.displayName,
        customDomain: body.customDomain,
        brand: body.brand,
        oauthDestinations: body.oauthDestinations,
        modules: body.modules,
        seed: body.seed,
        trustId: body.trustId,
        organization: body.organization,
        manifestVersion: body.manifestVersion,
        hq: body.hq,
        defaultCurrency: body.defaultCurrency,
        tariffs: body.tariffs,
        preset: body.preset,
        studioSettings: body.studioSettings,
      });
      return reply.code(201).send(result);
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.code(e.statusCode ?? 500).send({
        error: e.code ?? "provision_failed",
        message: e.message ?? "Provision failed",
      });
    }
  });
}
