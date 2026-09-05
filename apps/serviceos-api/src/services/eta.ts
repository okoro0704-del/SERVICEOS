import type { ProviderSkill } from "@serviceos/shared";
import { prisma } from "../db.js";
import { DEFAULT_SPEEDS, etaMinutesFromKm, haversineKm } from "../lib/geo.js";
import { getJobsProvider } from "./lifeos/container.js";

function speedMap(raw: unknown): Record<string, number> {
  if (raw && typeof raw === "object") return raw as Record<string, number>;
  return DEFAULT_SPEEDS;
}

export async function recalculateJobEta(jobId: string) {
  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  if (!job || !job.providerId) return null;
  const provider = await prisma.provider.findUnique({ where: { id: job.providerId } });
  if (!provider) return null;
  const studio = await prisma.studioConfig.findUnique({ where: { tenantId: job.tenantId } });
  const speeds = speedMap(studio?.travelSpeedsKmh);
  const speed = speeds[provider.skill] ?? DEFAULT_SPEEDS[provider.skill as ProviderSkill] ?? 28;

  const traveling = job.status === "ACCEPTED" || job.status === "OFFERED" || job.status === "EN_ROUTE";
  const etaMinutes = traveling
    ? etaMinutesFromKm(
        haversineKm({ lat: provider.lat, lng: provider.lng }, { lat: job.customerLat, lng: job.customerLng }),
        speed,
      )
    : 0;

  return prisma.serviceJob.update({
    where: { id: job.id },
    data: {
      lastEtaMinutes: job.etaMinutes,
      etaMinutes,
    },
  });
}

export async function enqueueEtaRecalc(jobId: string) {
  await getJobsProvider().enqueue({
    queue: "serviceos.eta",
    type: "serviceos.eta.recalculate",
    payload: { jobId },
  });
}
