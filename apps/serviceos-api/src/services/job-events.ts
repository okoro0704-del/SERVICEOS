import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export async function appendJobEvent(
  tx: Prisma.TransactionClient | typeof prisma,
  opts: {
    jobId: string;
    fromStatus?: string | null;
    toStatus: string;
    source: string;
    payload?: Record<string, unknown>;
  },
) {
  await tx.jobEvent.create({
    data: {
      jobId: opts.jobId,
      fromStatus: opts.fromStatus ?? null,
      toStatus: opts.toStatus,
      source: opts.source,
      payload: (opts.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
}
