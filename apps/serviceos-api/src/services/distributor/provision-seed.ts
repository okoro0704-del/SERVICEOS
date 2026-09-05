import { SERVICEOS_DEFAULT_SEED, SERVICEOS_MANIFEST, categoriesForPreset, normalizeServiceOSPreset, type ServiceOSPreset } from "@serviceos/shared";
import { prisma } from "../../db.js";

export async function seedStudioDefaults(opts: {
  tenantId: string;
  displayName: string;
  subdomain: string;
  preset?: ServiceOSPreset | string;
  tariffs?: {
    basePriceMinor?: number;
    perKmFeeMinor?: number;
    platformCommissionBps?: number;
    categoryMultipliers?: Record<string, number>;
  };
  studioSettings?: {
    cancellationWindowMinutes?: number;
    requireSkillCertifications?: boolean;
    requireProofOfServicePhoto?: boolean;
  };
  hq?: {
    addressLine1?: string;
    city?: string;
    country?: string;
    lat?: number;
    lng?: number;
  };
  defaultCurrency?: string;
}) {
  const seed = SERVICEOS_DEFAULT_SEED;
  const preset = opts.preset ? normalizeServiceOSPreset(opts.preset) : null;
  const allowed = preset ? new Set(categoriesForPreset(preset)) : null;
  const studio = await prisma.studioConfig.create({
    data: {
      tenantId: opts.tenantId,
      studioName: opts.displayName,
      subdomain: opts.subdomain,
      preset: preset ?? "beauty",
      defaultCurrency: opts.defaultCurrency ?? seed.studio.defaultCurrency,
      basePriceMinor: opts.tariffs?.basePriceMinor ?? seed.studio.basePriceMinor,
      perKmFeeMinor: opts.tariffs?.perKmFeeMinor ?? seed.studio.perKmFeeMinor,
      platformCommissionBps: opts.tariffs?.platformCommissionBps ?? seed.studio.platformCommissionBps,
      offerTimeoutSeconds: seed.studio.offerTimeoutSeconds,
      cancellationWindowMinutes: opts.studioSettings?.cancellationWindowMinutes ?? 60,
      requireSkillCertifications: opts.studioSettings?.requireSkillCertifications ?? true,
      requireProofOfServicePhoto: opts.studioSettings?.requireProofOfServicePhoto ?? true,
      categoryMultipliers: opts.tariffs?.categoryMultipliers ?? seed.studio.categoryMultipliers,
      travelSpeedsKmh: seed.studio.travelSpeedsKmh,
      hqAddressLine1: opts.hq?.addressLine1 ?? seed.studio.hqAddressLine1,
      hqCity: opts.hq?.city ?? seed.studio.hqCity,
      hqCountry: opts.hq?.country ?? seed.studio.hqCountry,
      hqLat: opts.hq?.lat ?? seed.studio.hqLat,
      hqLng: opts.hq?.lng ?? seed.studio.hqLng,
      platformPayeeId: "lifeos-master-ledger",
    },
  });

  const providers = [];
  for (const provider of seed.providers.filter((p) => !allowed || allowed.has(p.skill))) {
    const created = await prisma.provider.create({
      data: {
        tenantId: opts.tenantId,
        code: provider.code,
        displayName: provider.displayName,
        phone: provider.phone,
        trustId: `TD-PROVIDER-${provider.code}`,
        walletUserId: `wallet:${provider.code.toLowerCase()}`,
        skill: provider.skill,
        status: "AVAILABLE",
        lat: provider.lat,
        lng: provider.lng,
        lastPingAt: new Date(),
      },
    });
    providers.push(created);
  }

  const offerings = [];
  for (const offering of seed.offerings.filter((o) => !allowed || allowed.has(o.category))) {
    const created = await prisma.serviceOffering.create({
      data: {
        tenantId: opts.tenantId,
        sku: offering.sku,
        name: offering.name,
        category: offering.category,
        durationMinutes: offering.durationMinutes,
        priceMinor: offering.priceMinor,
      },
    });
    offerings.push(created);
  }

  return { studio, providers, offerings, preset: preset ?? "beauty", manifestVersion: SERVICEOS_MANIFEST.version };
}
