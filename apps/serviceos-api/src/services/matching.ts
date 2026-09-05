import type { ProviderSkill, ServiceCategory } from "@serviceos/shared";
import { SKILL_SUITABILITY } from "@serviceos/shared";
import { prisma } from "../db.js";
import { haversineKm } from "../lib/geo.js";

export async function matchNearestProvider(opts: {
  tenantId: string;
  destination: { lat: number; lng: number };
  category: ServiceCategory;
  excludeProviderIds?: string[];
}) {
  const allowed = SKILL_SUITABILITY[opts.category] ?? [opts.category];
  const providers = await prisma.provider.findMany({
    where: {
      tenantId: opts.tenantId,
      status: "AVAILABLE",
      ...(opts.excludeProviderIds?.length ? { id: { notIn: opts.excludeProviderIds } } : {}),
    },
  });

  const ranked = providers
    .filter((p) => allowed.includes(p.skill as ProviderSkill))
    .map((p) => ({
      provider: p,
      distanceKm: haversineKm({ lat: p.lat, lng: p.lng }, opts.destination),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return ranked[0] ?? null;
}
