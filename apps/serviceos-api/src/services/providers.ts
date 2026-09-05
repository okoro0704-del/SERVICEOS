import { prisma } from "../db.js";
import { httpError } from "../lib/crypto.js";
import { enqueueEtaRecalc, recalculateJobEta } from "./eta.js";
import { getTransportationClient } from "./transportation.js";

const ACTIVE_STATUSES = ["ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_SERVICE"];

export async function setProviderDuty(opts: { providerId: string; online: boolean }) {
  const provider = await prisma.provider.findUnique({ where: { id: opts.providerId } });
  if (!provider) throw httpError(404, "not_found", "Provider not found");
  const busyJobs = await prisma.serviceJob.count({
    where: {
      providerId: provider.id,
      status: { in: ACTIVE_STATUSES },
    },
  });
  const status = opts.online ? (busyJobs > 0 ? "BUSY" : "AVAILABLE") : "OFFLINE";
  return prisma.provider.update({
    where: { id: provider.id },
    data: { status, lastPingAt: new Date() },
  });
}

export async function pingProviderLocation(opts: { providerId: string; lat: number; lng: number }) {
  const provider = await prisma.provider.findUnique({ where: { id: opts.providerId } });
  if (!provider) throw httpError(404, "not_found", "Provider not found");
  const updated = await prisma.provider.update({
    where: { id: provider.id },
    data: { lat: opts.lat, lng: opts.lng, lastPingAt: new Date() },
  });

  const active = await prisma.serviceJob.findFirst({
    where: {
      providerId: provider.id,
      status: { in: ["OFFERED", ...ACTIVE_STATUSES] },
    },
    orderBy: { updatedAt: "desc" },
  });

  let job = active;
  if (active) {
    await getTransportationClient().pingLocation({
      serviceJobId: active.id,
      providerId: provider.id,
      lat: opts.lat,
      lng: opts.lng,
    });
    await enqueueEtaRecalc(active.id);
    job = await recalculateJobEta(active.id);
  }

  return { provider: updated, job };
}
