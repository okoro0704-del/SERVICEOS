import { prisma } from "../db.js";
import { config } from "../config.js";
import { httpError, otpEquals } from "../lib/crypto.js";
import {
  getFundzManWalletProvider,
  getLifeOsStorageProvider,
  getTrustIdProvider,
} from "./lifeos/container.js";
import { appendJobEvent } from "./job-events.js";
import { getSourceWebhookClient } from "./webhooks.js";

export async function uploadProofOfService(opts: {
  jobId: string;
  providerId: string;
  imageBase64: string;
  contentType?: string;
}) {
  const job = await prisma.serviceJob.findUnique({ where: { id: opts.jobId } });
  if (!job) throw httpError(404, "not_found", "Job not found");
  if (job.providerId !== opts.providerId) throw httpError(403, "forbidden", "Job is not assigned to this provider");

  const raw = opts.imageBase64.includes(",") ? opts.imageBase64.split(",")[1]! : opts.imageBase64;
  const body = Buffer.from(raw, "base64");
  const key = `pos/${opts.jobId}/${Date.now()}.jpg`;
  const stored = await getLifeOsStorageProvider().put({
    namespace: "serviceos",
    key,
    body,
    contentType: opts.contentType ?? "image/jpeg",
  });

  const updated = await prisma.serviceJob.update({
    where: { id: opts.jobId },
    data: {
      posImageUrl: stored.url ?? `drive://serviceos/${key}`,
      posDriveKey: stored.key,
    },
  });
  return { job: updated, storage: stored };
}

export async function completeService(opts: {
  jobId: string;
  providerId?: string;
  otpCode: string;
  posImageUrl?: string;
  posImageBase64?: string;
  contentType?: string;
}) {
  const job = await prisma.serviceJob.findUnique({ where: { id: opts.jobId }, include: { provider: true } });
  if (!job) throw httpError(404, "not_found", "Job not found");
  if (job.status === "COMPLETED") {
    return { job, skipped: true as const };
  }
  if (["UNASSIGNED", "OFFERED", "CANCELLED", "FAILED"].includes(job.status)) {
    throw httpError(409, "illegal_transition", `Cannot complete job in ${job.status}`);
  }
  if (opts.providerId && job.providerId && opts.providerId !== job.providerId) {
    throw httpError(403, "forbidden", "Job is not assigned to this provider");
  }

  const trustOk = await getTrustIdProvider().verifyDeliveryOtp({ jobId: job.id, otpCode: opts.otpCode });
  const hashOk = otpEquals(opts.otpCode, job.otpHash);
  if (!trustOk && !hashOk) {
    throw httpError(401, "invalid_otp", "Service PIN is invalid");
  }

  let posImageUrl = opts.posImageUrl ?? job.posImageUrl;
  let posDriveKey = job.posDriveKey;
  if (opts.posImageBase64) {
    const uploaded = await uploadProofOfService({
      jobId: job.id,
      providerId: job.providerId ?? opts.providerId ?? "",
      imageBase64: opts.posImageBase64,
      contentType: opts.contentType,
    });
    posImageUrl = uploaded.job.posImageUrl;
    posDriveKey = uploaded.job.posDriveKey;
  }

  const providerWalletId = job.provider?.walletUserId ?? job.providerId ?? "serviceos-provider-pool";
  const wallet = getFundzManWalletProvider();

  let providerTransfer = null;
  let platformTransfer = null;
  let release = null;

  if (job.escrowId) {
    release = await wallet.releaseEscrow({
      paymentId: job.escrowId,
      currency: job.currency,
      reference: job.id,
      splits: [
        { payeeId: providerWalletId, role: "rider", amount: job.providerPayoutMinor },
        { payeeId: config.masterLedgerWalletId, role: "platform", amount: job.platformCommissionMinor },
      ],
      metadata: { jobId: job.id, orderId: job.orderId, role: "provider" },
    });
  } else {
    providerTransfer = await wallet.transfer({
      fromWalletId: config.escrowSourceWalletId,
      toWalletId: providerWalletId,
      amount: job.providerPayoutMinor,
      currency: job.currency,
      reference: job.id,
      role: "rider",
      metadata: { orderId: job.orderId, jobId: job.id, role: "provider" },
    });
    platformTransfer = await wallet.transfer({
      fromWalletId: config.escrowSourceWalletId,
      toWalletId: config.masterLedgerWalletId,
      amount: job.platformCommissionMinor,
      currency: job.currency,
      reference: job.id,
      role: "platform",
      metadata: { orderId: job.orderId, jobId: job.id },
    });
  }

  const completed = await prisma.$transaction(async (tx) => {
    if (job.providerId) {
      await tx.provider.update({ where: { id: job.providerId }, data: { status: "AVAILABLE" } });
    }
    const next = await tx.serviceJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        settledAt: new Date(),
        posImageUrl: posImageUrl ?? null,
        posDriveKey: posDriveKey ?? null,
        settlementReleaseId: release?.releaseId ?? providerTransfer?.transferId ?? null,
      },
    });
    await appendJobEvent(tx, {
      jobId: job.id,
      fromStatus: job.status,
      toStatus: "COMPLETED",
      source: "service.complete",
      payload: {
        providerTransferId: providerTransfer?.transferId ?? null,
        platformTransferId: platformTransfer?.transferId ?? null,
        releaseId: release?.releaseId ?? null,
      },
    });
    return next;
  });

  await getSourceWebhookClient().notify({
    serviceJobId: job.id,
    orderId: job.orderId,
    status: "COMPLETED",
    sourceDomain: job.sourceDomain,
  });

  return {
    job: completed,
    skipped: false as const,
    payout: {
      provider: providerTransfer,
      platform: platformTransfer,
      release,
    },
  };
}
