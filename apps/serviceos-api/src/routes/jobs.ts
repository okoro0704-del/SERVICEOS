import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { httpError } from "../lib/crypto.js";
import { completeService, uploadProofOfService } from "../services/settlement.js";
import { getFundzManWalletProvider, getLifeOsMessagingProvider } from "../services/lifeos/container.js";

function providerIdFrom(req: { headers: Record<string, unknown>; body?: unknown }): string {
  const header = req.headers["x-provider-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const body = req.body as { providerId?: string } | undefined;
  if (body?.providerId) return body.providerId;
  throw httpError(401, "unauthorized", "x-provider-id header or providerId is required");
}

export async function registerJobRoutes(app: FastifyInstance) {
  app.get("/v1/jobs/:jobId", async (req) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params);
    const job = await prisma.serviceJob.findUnique({
      where: { id: jobId },
      include: { provider: true, events: true },
    });
    if (!job) throw httpError(404, "not_found", "Job not found");
    return { job };
  });

  app.post("/v1/jobs/:jobId/pos", async (req) => {
    const providerId = providerIdFrom(req);
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params);
    const body = z
      .object({
        imageBase64: z.string().min(8),
        contentType: z.string().optional(),
        providerId: z.string().optional(),
      })
      .parse(req.body);
    const result = await uploadProofOfService({
      jobId,
      providerId,
      imageBase64: body.imageBase64,
      contentType: body.contentType,
    });
    return { ok: true, posImageUrl: result.job.posImageUrl, storage: result.storage };
  });

  app.post("/v1/jobs/:jobId/complete", async (req, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params);
    const body = z
      .object({
        otpCode: z.string().regex(/^\d{4}$/),
        posImageUrl: z.string().optional(),
        posImageBase64: z.string().optional(),
        contentType: z.string().optional(),
        providerId: z.string().optional(),
      })
      .parse(req.body);

    const headerProvider = req.headers["x-provider-id"];
    const providerId =
      body.providerId ??
      (typeof headerProvider === "string" && headerProvider.trim() ? headerProvider.trim() : undefined);

    const result = await completeService({
      jobId,
      providerId,
      otpCode: body.otpCode,
      posImageUrl: body.posImageUrl,
      posImageBase64: body.posImageBase64,
      contentType: body.contentType,
    });

    return reply.code(200).send({
      ok: true,
      status: result.job.status,
      jobId: result.job.id,
      payout: result.payout,
      posImageUrl: result.job.posImageUrl,
    });
  });

  app.get("/v1/jobs/:jobId/chat", async (req) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params);
    const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
    if (!job) throw httpError(404, "not_found", "Job not found");
    const messaging = getLifeOsMessagingProvider();
    const messages = messaging.listMessages ? await messaging.listMessages(jobId) : [];
    return { threadId: jobId, messages };
  });

  app.post("/v1/jobs/:jobId/chat", async (req) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params);
    const body = z
      .object({
        from: z.enum(["customer", "provider"]),
        body: z.string().min(1),
        ownerTrustId: z.string().optional(),
      })
      .parse(req.body);
    const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
    if (!job) throw httpError(404, "not_found", "Job not found");
    const sent = await getLifeOsMessagingProvider().sendMessage({
      ownerTrustId:
        body.ownerTrustId ??
        (body.from === "provider" ? job.providerId ?? "provider" : job.buyerTrustId ?? "customer"),
      threadId: jobId,
      body: body.body,
      channel: "chat",
    });
    return { ok: true, ...sent };
  });

  app.get("/v1/provider/wallet", async (req) => {
    const providerId = providerIdFrom(req);
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw httpError(404, "not_found", "Provider not found");
    const summary = await getFundzManWalletProvider().getWalletSummary(provider.walletUserId);
    return { wallet: summary, providerId: provider.id };
  });

  app.post("/v1/provider/wallet/withdraw", async (req) => {
    const providerId = providerIdFrom(req);
    const body = z
      .object({
        amount: z.number().positive(),
        destination: z.string().optional(),
        providerId: z.string().optional(),
      })
      .parse(req.body);
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw httpError(404, "not_found", "Provider not found");
    const result = await getFundzManWalletProvider().withdraw({
      userId: provider.walletUserId,
      amount: body.amount,
      currency: "NGN",
      destination: body.destination,
    });
    const wallet = await getFundzManWalletProvider().getWalletSummary(provider.walletUserId);
    return { withdrawal: result, wallet };
  });
}
