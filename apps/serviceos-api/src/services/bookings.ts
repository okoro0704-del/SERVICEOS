import type { ServiceCategory } from "@serviceos/shared";
import { prisma } from "../db.js";
import { haversineKm, quoteBookingBreakdown } from "../lib/geo.js";
import { httpError } from "../lib/crypto.js";
import { getFundzManWalletProvider } from "./lifeos/container.js";
import { ingestDispatch } from "./dispatch.js";

export type QuoteInput = {
  tenantId?: string;
  offeringSku?: string;
  category?: ServiceCategory | string;
  lat: number;
  lng: number;
};

export async function quoteBooking(input: QuoteInput) {
  const tenant = input.tenantId
    ? await prisma.tenant.findFirst({
        where: { OR: [{ id: input.tenantId }, { slug: input.tenantId }] },
      })
    : await prisma.tenant.findFirst({ where: { status: "active" }, orderBy: { createdAt: "asc" } });
  if (!tenant) throw httpError(409, "tenant_missing", "No ServiceOS tenant has been provisioned");

  const studio = await prisma.studioConfig.findUnique({ where: { tenantId: tenant.id } });
  if (!studio) throw httpError(409, "studio_missing", "Studio has not been provisioned");

  const offering = input.offeringSku
    ? await prisma.serviceOffering.findFirst({ where: { tenantId: tenant.id, sku: input.offeringSku } })
    : input.category
      ? await prisma.serviceOffering.findFirst({
          where: { tenantId: tenant.id, category: input.category },
          orderBy: { priceMinor: "asc" },
        })
      : await prisma.serviceOffering.findFirst({ where: { tenantId: tenant.id }, orderBy: { priceMinor: "asc" } });

  if (!offering) throw httpError(404, "offering_missing", "No catalog offering found");

  const multipliers =
    studio.categoryMultipliers && typeof studio.categoryMultipliers === "object"
      ? (studio.categoryMultipliers as Record<string, number>)
      : {};
  const multiplier = multipliers[offering.category] ?? 1;
  const distanceKm = haversineKm(
    { lat: studio.hqLat, lng: studio.hqLng },
    { lat: input.lat, lng: input.lng },
  );
  const fees = quoteBookingBreakdown({
    distanceKm,
    baseFeeMinor: Math.round(offering.priceMinor * multiplier),
    perKmFeeMinor: studio.perKmFeeMinor,
  });

  return {
    tenantId: tenant.id,
    offering: {
      id: offering.id,
      sku: offering.sku,
      name: offering.name,
      category: offering.category,
      durationMinutes: offering.durationMinutes,
    },
    currency: studio.defaultCurrency,
    perKmFeeMinor: studio.perKmFeeMinor,
    cancellationWindowMinutes: studio.cancellationWindowMinutes,
    ...fees,
  };
}

export type CreateBookingInput = {
  tenantId?: string;
  offeringSku?: string;
  category?: ServiceCategory | string;
  scheduleMode?: "asap" | "slot";
  scheduledAt?: string | null;
  customer: {
    lat: number;
    lng: number;
    addressLine1?: string;
    city?: string;
    country?: string;
    contactName?: string | null;
    contactPhone?: string | null;
    accessNotes?: string | null;
    gateCode?: string | null;
  };
  buyer?: { trustId?: string; name?: string; phone?: string | null; email?: string | null };
};

export async function createCustomerBooking(input: CreateBookingInput) {
  const quote = await quoteBooking({
    tenantId: input.tenantId,
    offeringSku: input.offeringSku,
    category: input.category,
    lat: input.customer.lat,
    lng: input.customer.lng,
  });

  const wallet = getFundzManWalletProvider();
  const payment = await wallet.initiatePayment({
    payerTrustId: input.buyer?.trustId ?? "TD-GUEST",
    payeeId: "serviceos",
    amount: quote.totalMinor,
    currency: quote.currency,
    escrow: true,
    reference: `book-${quote.offering.sku}-${Date.now()}`,
  });

  const result = await ingestDispatch({
    sourceDomain: "lifeos",
    tenantId: quote.tenantId,
    orderId: `book_${Date.now().toString(36)}`,
    category: quote.offering.category,
    offeringSku: quote.offering.sku,
    durationMinutes: quote.offering.durationMinutes,
    customer: input.customer,
    escrowId: payment.paymentId,
    serviceFeeMinor: quote.totalMinor,
    baseFeeMinor: quote.baseFeeMinor,
    travelFeeMinor: quote.travelFeeMinor,
    scheduleMode: input.scheduleMode ?? "asap",
    scheduledAt: input.scheduledAt,
    accessNotes: input.customer.accessNotes,
    gateCode: input.customer.gateCode,
    buyer: input.buyer,
  });

  return {
    ...result,
    bookingId: result.jobId,
    paymentId: payment.paymentId,
    escrowStatus: payment.status,
    quote,
    trackingPath: `/track/booking/${result.jobId}`,
    baseFeeMinor: quote.baseFeeMinor,
    travelFeeMinor: quote.travelFeeMinor,
    serviceFeeMinor: quote.totalMinor,
  };
}
