import type { JobPriority, ServiceCategory, SourceDomain } from "@serviceos/shared";
import { JOB_STATUS_TO_WEBHOOK, SERVICEOS_DEFAULT_SEED } from "@serviceos/shared";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { hashOtp, httpError } from "../lib/crypto.js";
import { DEFAULT_SPEEDS, etaMinutesFromKm, haversineKm, quoteBookingBreakdown } from "../lib/geo.js";
import { getJobsProvider, getLifeOsMessagingProvider, getTrustIdProvider } from "./lifeos/container.js";
import { matchNearestProvider } from "./matching.js";
import { appendJobEvent } from "./job-events.js";
import { getSourceWebhookClient } from "./webhooks.js";
import { recalculateJobEta } from "./eta.js";
import { getTransportationClient } from "./transportation.js";

export type GeoPoint = {
  lat: number;
  lng: number;
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string;
  region?: string | null;
  postalCode?: string | null;
  country?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  accessNotes?: string | null;
  gateCode?: string | null;
};

export type DispatchIngestInput = {
  sourceDomain?: SourceDomain | string;
  tenantId?: string;
  orderId: string;
  category?: ServiceCategory | string;
  offeringSku?: string;
  durationMinutes?: number;
  customer: GeoPoint;
  priority?: JobPriority | string;
  escrowId?: string | null;
  serviceFee?: number;
  serviceFeeMinor?: number;
  baseFeeMinor?: number;
  travelFeeMinor?: number;
  scheduleMode?: "asap" | "slot";
  scheduledAt?: string | Date | null;
  accessNotes?: string | null;
  gateCode?: string | null;
  buyer?: { trustId?: string; name?: string; phone?: string | null; email?: string | null };
};

function asSourceDomain(raw: string | undefined): SourceDomain {
  if (raw === "hospitalityos") return "hospitalityos";
  if (raw === "ecommerceos") return "ecommerceos";
  return "lifeos";
}

function multipliers(raw: unknown): Record<string, number> {
  if (raw && typeof raw === "object") return raw as Record<string, number>;
  return SERVICEOS_DEFAULT_SEED.studio.categoryMultipliers;
}

function speeds(raw: unknown): Record<string, number> {
  if (raw && typeof raw === "object") return raw as Record<string, number>;
  return DEFAULT_SPEEDS;
}

export async function offerJobToProvider(jobId: string, excludeProviderIds: string[] = []) {
  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (job.status !== "UNASSIGNED" && job.status !== "OFFERED") return job;

  const match = await matchNearestProvider({
    tenantId: job.tenantId,
    destination: { lat: job.customerLat, lng: job.customerLng },
    category: job.category as ServiceCategory,
    excludeProviderIds,
  });

  if (!match) {
    return prisma.serviceJob.update({
      where: { id: job.id },
      data: { status: "UNASSIGNED", offeredProviderId: null, providerId: null, offerExpiresAt: null },
    });
  }

  const studio = await prisma.studioConfig.findUnique({ where: { tenantId: job.tenantId } });
  const timeoutSec = studio?.offerTimeoutSeconds ?? 30;
  const offerExpiresAt = new Date(Date.now() + timeoutSec * 1000);
  const speed = speeds(studio?.travelSpeedsKmh)[match.provider.skill] ?? 28;
  const etaMinutes = etaMinutesFromKm(match.distanceKm, speed);

  const offered = await prisma.serviceJob.update({
    where: { id: job.id },
    data: {
      status: "OFFERED",
      offeredProviderId: match.provider.id,
      providerId: match.provider.id,
      offerExpiresAt,
      distanceKm: match.distanceKm,
      etaMinutes,
      lastEtaMinutes: job.etaMinutes,
    },
  });

  await appendJobEvent(prisma, {
    jobId: job.id,
    fromStatus: job.status,
    toStatus: "OFFERED",
    source: "matching.auto",
    payload: { providerId: match.provider.id, distanceKm: match.distanceKm },
  });

  await getJobsProvider().enqueue({
    queue: "serviceos.offers",
    type: "serviceos.offer.expire",
    payload: { jobId: job.id, providerId: match.provider.id },
    delayMs: timeoutSec * 1000,
  });

  return offered;
}

export async function ingestDispatch(input: DispatchIngestInput) {
  const sourceDomain = asSourceDomain(input.sourceDomain);
  const tenant = input.tenantId
    ? await prisma.tenant.findFirst({
        where: { OR: [{ id: input.tenantId }, { slug: input.tenantId }, { lifeosBusinessId: input.tenantId }] },
      })
    : await prisma.tenant.findFirst({ where: { status: "active" }, orderBy: { createdAt: "asc" } });

  if (!tenant) throw httpError(409, "tenant_missing", "No ServiceOS tenant has been provisioned");

  const studio = await prisma.studioConfig.findUnique({ where: { tenantId: tenant.id } });
  if (!studio) throw httpError(409, "studio_missing", "Studio has not been provisioned");

  const customer = input.customer;
  if (typeof customer?.lat !== "number" || typeof customer?.lng !== "number") {
    throw httpError(400, "invalid_customer", "customer.lat and customer.lng are required");
  }

  const offering = input.offeringSku
    ? await prisma.serviceOffering.findFirst({
        where: { tenantId: tenant.id, sku: input.offeringSku },
      })
    : input.category
      ? await prisma.serviceOffering.findFirst({
          where: { tenantId: tenant.id, category: input.category },
          orderBy: { priceMinor: "asc" },
        })
      : await prisma.serviceOffering.findFirst({
          where: { tenantId: tenant.id },
          orderBy: { priceMinor: "asc" },
        });

  const category = (input.category ?? offering?.category ?? "barber") as ServiceCategory;
  const durationMinutes = input.durationMinutes ?? offering?.durationMinutes ?? 60;
  const distanceKm = haversineKm(
    { lat: studio.hqLat, lng: studio.hqLng },
    { lat: customer.lat, lng: customer.lng },
  );
  const multiplier = multipliers(studio.categoryMultipliers)[category] ?? 1;
  const breakdown = quoteBookingBreakdown({
    distanceKm,
    baseFeeMinor: Math.round((offering?.priceMinor ?? studio.basePriceMinor) * multiplier),
    perKmFeeMinor: studio.perKmFeeMinor,
  });
  const baseFeeMinor = input.baseFeeMinor ?? breakdown.baseFeeMinor;
  const travelFeeMinor = input.travelFeeMinor ?? breakdown.travelFeeMinor;
  const serviceFeeMinor = input.serviceFeeMinor ?? input.serviceFee ?? baseFeeMinor + travelFeeMinor;
  const platformCommissionMinor = Math.round((serviceFeeMinor * studio.platformCommissionBps) / 10_000);
  const providerPayoutMinor = serviceFeeMinor - platformCommissionMinor;

  const provisionalId = `pending_${Date.now()}`;
  const otp = await getTrustIdProvider().issueDeliveryOtp({
    jobId: provisionalId,
    recipientTrustId: input.buyer?.trustId,
    purpose: "delivery",
  });

  const job = await prisma.serviceJob.create({
    data: {
      tenantId: tenant.id,
      sourceDomain,
      sourceTenantId: input.tenantId ?? null,
      orderId: input.orderId,
      offeringId: offering?.id ?? null,
      category,
      durationMinutes,
      escrowId: input.escrowId ?? null,
      status: "UNASSIGNED",
      priority: input.priority ?? "standard",
      currency: studio.defaultCurrency,
      serviceFeeMinor,
      baseFeeMinor,
      travelFeeMinor,
      providerPayoutMinor,
      platformCommissionMinor,
      distanceKm,
      scheduleMode: input.scheduleMode ?? "asap",
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      accessNotes: input.accessNotes ?? customer.accessNotes ?? customer.addressLine2 ?? null,
      gateCode: input.gateCode ?? customer.gateCode ?? null,
      otpHash: hashOtp(otp.otpCode),
      otpCode: otp.otpCode,
      customerLat: customer.lat,
      customerLng: customer.lng,
      customerAddressLine1: customer.addressLine1 ?? "",
      customerAddressLine2: customer.addressLine2 ?? null,
      customerCity: customer.city ?? "",
      customerRegion: customer.region ?? null,
      customerPostalCode: customer.postalCode ?? null,
      customerCountry: customer.country ?? studio.hqCountry,
      customerContactName: customer.contactName ?? input.buyer?.name ?? null,
      customerContactPhone: customer.contactPhone ?? input.buyer?.phone ?? null,
      buyerTrustId: input.buyer?.trustId ?? null,
      buyerName: input.buyer?.name ?? null,
      buyerPhone: input.buyer?.phone ?? null,
      buyerEmail: input.buyer?.email ?? null,
      trackingUrl: config.trackingPublicUrlTemplate.replaceAll("{jobId}", "pending"),
    },
  });

  const trackingUrl = config.trackingPublicUrlTemplate.replaceAll("{jobId}", job.id);
  await prisma.serviceJob.update({
    where: { id: job.id },
    data: { trackingUrl },
  });

  await getTrustIdProvider()
    .issueDeliveryOtp({
      jobId: job.id,
      recipientTrustId: input.buyer?.trustId,
      purpose: "delivery",
    })
    .then(async (reissued) => {
      await prisma.serviceJob.update({
        where: { id: job.id },
        data: { otpCode: reissued.otpCode, otpHash: hashOtp(reissued.otpCode) },
      });
      otp.otpCode = reissued.otpCode;
    });

  await appendJobEvent(prisma, {
    jobId: job.id,
    toStatus: "UNASSIGNED",
    source: "dispatch.ingest",
    payload: { orderId: input.orderId, sourceDomain, category },
  });

  const phone = input.buyer?.phone ?? customer.contactPhone;
  if (phone) {
    await getLifeOsMessagingProvider().sendMessage({
      ownerTrustId: input.buyer?.trustId ?? "customer",
      threadId: job.id,
      channel: "sms",
      to: phone,
      body: `Track your ServiceOS visit: ${trackingUrl} PIN: ${otp.otpCode}`,
    });
  }

  const offered = await offerJobToProvider(job.id);
  const current = offered ?? (await prisma.serviceJob.findUnique({ where: { id: job.id } }));

  if (current?.providerId) {
    const provider = await prisma.provider.findUnique({ where: { id: current.providerId } });
    if (provider) {
      const movement = await getTransportationClient().ingestMovement({
        serviceJobId: job.id,
        tenantId: tenant.id,
        orderId: input.orderId,
        origin: { lat: provider.lat, lng: provider.lng, addressLine1: studio.hqAddressLine1, city: studio.hqCity },
        destination: {
          lat: customer.lat,
          lng: customer.lng,
          addressLine1: customer.addressLine1,
          city: customer.city,
        },
        escrowId: input.escrowId,
      });
      await prisma.serviceJob.update({
        where: { id: job.id },
        data: { transportationJobId: movement.transportationJobId },
      });
    }
  }

  const fresh = await prisma.serviceJob.findUnique({ where: { id: job.id } });

  return {
    serviceJobId: job.id,
    jobId: job.id,
    status: fresh?.status ?? current?.status ?? "UNASSIGNED",
    otpCode: otp.otpCode,
    trackingUrl,
    etaMinutes: fresh?.etaMinutes ?? current?.etaMinutes ?? null,
    providerId: fresh?.providerId ?? current?.providerId ?? null,
    transportationJobId: fresh?.transportationJobId ?? null,
    serviceFeeMinor,
    baseFeeMinor,
    travelFeeMinor,
    providerPayoutMinor,
    platformCommissionMinor,
    distanceKm: fresh?.distanceKm ?? distanceKm,
    category,
  };
}

export async function expireOffer(jobId: string, providerId: string) {
  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.status !== "OFFERED") return;
  if (job.offeredProviderId !== providerId) return;
  await prisma.serviceJob.update({
    where: { id: jobId },
    data: { status: "UNASSIGNED", offeredProviderId: null, providerId: null, offerExpiresAt: null },
  });
  await appendJobEvent(prisma, {
    jobId,
    fromStatus: "OFFERED",
    toStatus: "UNASSIGNED",
    source: "offer.expire",
    payload: { providerId },
  });
  await offerJobToProvider(jobId, [providerId]);
}

export async function acceptJob(jobId: string, providerId: string) {
  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) throw httpError(404, "not_found", "Job not found");
  if (job.status !== "OFFERED") throw httpError(409, "illegal_transition", `Cannot accept job in ${job.status}`);
  if (job.providerId !== providerId && job.offeredProviderId !== providerId) {
    throw httpError(403, "forbidden", "Job is not offered to this provider");
  }
  const now = new Date();
  if (job.offerExpiresAt && job.offerExpiresAt < now) {
    throw httpError(409, "offer_expired", "Offer window has expired");
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.provider.update({ where: { id: providerId }, data: { status: "BUSY" } });
    const next = await tx.serviceJob.update({
      where: { id: jobId },
      data: {
        status: "ACCEPTED",
        providerId,
        acceptedAt: now,
        assignedAt: now,
        offerExpiresAt: null,
      },
    });
    await appendJobEvent(tx, {
      jobId,
      fromStatus: job.status,
      toStatus: "ACCEPTED",
      source: "provider.accept",
      payload: { providerId },
    });
    return next;
  });
  await recalculateJobEta(jobId);
  return prisma.serviceJob.findUnique({ where: { id: updated.id }, include: { provider: true } });
}

export async function declineJob(jobId: string, providerId: string) {
  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) throw httpError(404, "not_found", "Job not found");
  if (job.status !== "OFFERED") throw httpError(409, "illegal_transition", `Cannot decline job in ${job.status}`);
  await prisma.serviceJob.update({
    where: { id: jobId },
    data: { status: "UNASSIGNED", offeredProviderId: null, providerId: null, offerExpiresAt: null },
  });
  await appendJobEvent(prisma, {
    jobId,
    fromStatus: "OFFERED",
    toStatus: "UNASSIGNED",
    source: "provider.decline",
    payload: { providerId },
  });
  return offerJobToProvider(jobId, [providerId]);
}

const PIPELINE: Record<string, string> = {
  ACCEPTED: "EN_ROUTE",
  EN_ROUTE: "ARRIVED",
  ARRIVED: "IN_SERVICE",
};

export async function advanceJob(jobId: string, providerId: string, action?: string) {
  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) throw httpError(404, "not_found", "Job not found");
  if (job.providerId !== providerId) throw httpError(403, "forbidden", "Job is not assigned to this provider");

  const intended =
    action === "start_navigation"
      ? "EN_ROUTE"
      : action === "arrive"
        ? "ARRIVED"
        : action === "start_service"
          ? "IN_SERVICE"
          : PIPELINE[job.status];

  if (!intended) throw httpError(409, "illegal_transition", `No next step from ${job.status}`);
  if (PIPELINE[job.status] !== intended) {
    throw httpError(409, "illegal_transition", `Expected ${PIPELINE[job.status]} from ${job.status}`);
  }

  const data: Record<string, unknown> = { status: intended };
  if (intended === "ARRIVED") data.arrivedAt = new Date();
  if (intended === "IN_SERVICE") data.startedAt = new Date();

  const updated = await prisma.serviceJob.update({
    where: { id: jobId },
    data,
  });
  await appendJobEvent(prisma, {
    jobId,
    fromStatus: job.status,
    toStatus: intended,
    source: "provider.advance",
    payload: { action: action ?? "next" },
  });

  const webhookStatus = JOB_STATUS_TO_WEBHOOK[intended];
  if (webhookStatus) {
    await getSourceWebhookClient().notify({
      serviceJobId: job.id,
      orderId: job.orderId,
      status: webhookStatus,
      sourceDomain: job.sourceDomain,
    });
  }

  await recalculateJobEta(jobId);
  return prisma.serviceJob.findUnique({ where: { id: updated.id }, include: { provider: true } });
}

export function publicJobView(job: {
  id: string;
  status: string;
  category: string;
  etaMinutes: number | null;
  otpCode: string;
  trackingUrl: string;
  customerLat: number;
  customerLng: number;
  customerAddressLine1: string;
  customerCity: string;
  providerId: string | null;
  buyerName: string | null;
  serviceFeeMinor: number;
  providerPayoutMinor: number;
  distanceKm: number;
  sourceDomain: string;
  orderId: string;
  durationMinutes: number;
  baseFeeMinor?: number;
  travelFeeMinor?: number;
  accessNotes?: string | null;
  gateCode?: string | null;
  scheduleMode?: string;
  scheduledAt?: Date | null;
}) {
  return {
    jobId: job.id,
    bookingId: job.id,
    status: job.status,
    category: job.category,
    etaMinutes: job.etaMinutes,
    otpCode: job.otpCode,
    trackingUrl: job.trackingUrl,
    customer: {
      lat: job.customerLat,
      lng: job.customerLng,
      addressLine1: job.customerAddressLine1,
      city: job.customerCity,
    },
    providerId: job.providerId,
    buyerName: job.buyerName,
    serviceFeeMinor: job.serviceFeeMinor,
    baseFeeMinor: job.baseFeeMinor ?? 0,
    travelFeeMinor: job.travelFeeMinor ?? 0,
    providerPayoutMinor: job.providerPayoutMinor,
    distanceKm: job.distanceKm,
    sourceDomain: job.sourceDomain,
    orderId: job.orderId,
    durationMinutes: job.durationMinutes,
    accessNotes: job.accessNotes ?? null,
    gateCode: job.gateCode ?? null,
    scheduleMode: job.scheduleMode ?? "asap",
    scheduledAt: job.scheduledAt ?? null,
  };
}
