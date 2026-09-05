/**
 * ServiceOS E2E suite — primitives, Portal provision, LifeOS dispatch,
 * provider accept + live ETA, OTP completion, Sovereign Drive POS, FundzMan payout.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import {
  SERVICEOS_DEFAULT_MODULES,
  SERVICEOS_DEFAULT_SEED,
} from "../../../packages/shared/src/manifest/serviceos.manifest.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const testDbPath = path.join(apiRoot, "prisma", `serviceos-suite-${process.pid}.db`);

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:./serviceos-suite-${process.pid}.db`;
process.env.INTERNAL_PROVISION_TOKEN = "portal-e2e-token";
process.env.PRIMITIVES_MODE = "local";
process.env.WEBHOOK_MODE = "local";
process.env.TRANSPORTATION_MODE = "local";
process.env.SOS_SKIP_PRODUCTION_ASSERT = "true";
process.env.TRACKING_PUBLIC_URL = "https://track.lifeos.app/service/{jobId}";

const POS_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let app: FastifyInstance;
let prisma: PrismaClient;
let tenantId = "";
let providerId = "";
let providerWalletId = "";
let jobId = "";
let otpCode = "";
let escrowId = "";
let serviceFeeMinor = 0;
let providerPayoutMinor = 0;
let platformCommissionMinor = 0;

before(async () => {
  for (const file of [testDbPath, `${testDbPath}-journal`, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // Windows may keep a handle from a previous run.
    }
  }
  execSync("npx prisma db push --skip-generate", {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: `file:./serviceos-suite-${process.pid}.db`, NODE_ENV: "test" },
    stdio: "pipe",
  });

  const { buildApp } = await import("../src/app.ts");
  app = await buildApp();
  await app.ready();
  prisma = new PrismaClient();
});

after(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
});

test("1. primitive binding boot validation for all 6 Phase F primitives", async () => {
  const { getRegisteredLifeOsPrimitives } = await import("../src/services/register-primitives.ts");
  const { assertLifeOsPrimitivesReady } = await import("../src/services/lifeos/container.ts");
  const c = getRegisteredLifeOsPrimitives();
  assert.equal(c.trustId.primitiveId, "trust-id");
  assert.equal(c.messaging.primitiveId, "elfcom");
  assert.equal(c.storage.primitiveId, "sovereign-drive");
  assert.equal(c.jobs.primitiveId, "platform-jobs");
  assert.equal(c.distributor.primitiveId, "master-distributor");
  assert.equal(c.wallet.primitiveId, "fundzman");
  assert.ok(c.trustId.bound && c.messaging.bound && c.storage.bound);
  assert.ok(c.jobs.bound && c.distributor.bound && c.wallet.bound);
  const ready = await assertLifeOsPrimitivesReady();
  assert.equal(ready.ok, true);
  assert.equal(ready.count, 6);
  assert.deepEqual(ready.ids, [
    "trust-id",
    "elfcom",
    "sovereign-drive",
    "platform-jobs",
    "master-distributor",
    "fundzman",
  ]);

  const health = await app.inject({ method: "GET", url: "/health/primitives" });
  assert.equal(health.statusCode, 200, health.body);
  const body = health.json() as { ok: boolean; count: number; ids: string[] };
  assert.equal(body.ok, true);
  assert.equal(body.count, 6);
});

test("2. Portal internal tenant provisioning via POST /internal/distributor/provision", async () => {
  const unauthorized = await app.inject({
    method: "POST",
    url: "/internal/distributor/provision",
    payload: { tenantId: "tid_noauth", subdomain: "noauth-studio", displayName: "No Auth" },
  });
  assert.equal(unauthorized.statusCode, 401);

  const subdomain = `harbor-${Date.now().toString(36)}`;
  const res = await app.inject({
    method: "POST",
    url: "/internal/distributor/provision",
    headers: { authorization: "Bearer portal-e2e-token" },
    payload: {
      tenantId: `tid_${subdomain}`,
      subdomain,
      displayName: "Harbor Studio",
      brand: { primaryColor: "#14B8A6" },
      seed: "default",
      trustId: { audience: "serviceos", businessPublicId: `biz_${subdomain}` },
      tariffs: {
        basePriceMinor: SERVICEOS_DEFAULT_SEED.studio.basePriceMinor,
        perKmFeeMinor: SERVICEOS_DEFAULT_SEED.studio.perKmFeeMinor,
      },
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json() as {
    ok: boolean;
    tenantId: string;
    modulesEnabled: string[];
    seedApplied: boolean;
    primitiveBindings: Record<string, { bound: boolean }>;
    studio: { basePriceMinor: number; perKmFeeMinor: number; providersSeeded: number };
    providers: Array<{ id: string; code: string; skill: string }>;
    subdomainRouting: string;
  };
  assert.equal(body.ok, true);
  assert.equal(body.seedApplied, true);
  tenantId = body.tenantId;
  for (const m of SERVICEOS_DEFAULT_MODULES) {
    assert.ok(body.modulesEnabled.includes(m), `missing module ${m}`);
  }
  assert.equal(body.primitiveBindings["trust-id"]?.bound, true);
  assert.equal(body.primitiveBindings.elfcom?.bound, true);
  assert.equal(body.primitiveBindings["sovereign-drive"]?.bound, true);
  assert.equal(body.primitiveBindings["platform-jobs"]?.bound, true);
  assert.equal(body.primitiveBindings["master-distributor"]?.bound, true);
  assert.equal(body.primitiveBindings.fundzman?.bound, true);
  assert.equal(body.studio.basePriceMinor, SERVICEOS_DEFAULT_SEED.studio.basePriceMinor);
  assert.equal(body.studio.perKmFeeMinor, SERVICEOS_DEFAULT_SEED.studio.perKmFeeMinor);
  assert.equal(body.studio.providersSeeded, SERVICEOS_DEFAULT_SEED.providers.length);
  assert.ok(body.subdomainRouting);

  const ada = body.providers.find((p) => p.code === "ADA-BARBER");
  assert.ok(ada);
  providerId = ada!.id;
  const provider = await prisma.provider.findUnique({ where: { id: providerId } });
  assert.ok(provider);
  providerWalletId = provider!.walletUserId;
  assert.equal(provider!.status, "AVAILABLE");
  assert.equal(provider!.skill, "barber");

  const studio = await prisma.studioConfig.findUnique({ where: { tenantId } });
  assert.ok(studio);
  assert.equal(studio!.hqCity, SERVICEOS_DEFAULT_SEED.studio.hqCity);
});

test("3. ingest a service job from LifeOS via POST /internal/serviceos/dispatch", async () => {
  const { getLocalFundzMan, getLocalElfCom } = await import("../src/services/register-primitives.ts");
  const { getLocalTransportation } = await import("../src/services/transportation.ts");
  const wallet = getLocalFundzMan()!;
  serviceFeeMinor = 250_000;
  platformCommissionMinor = Math.round(
    (serviceFeeMinor * SERVICEOS_DEFAULT_SEED.studio.platformCommissionBps) / 10_000,
  );
  providerPayoutMinor = serviceFeeMinor - platformCommissionMinor;

  const payment = await wallet.initiatePayment({
    payerTrustId: "TD-BUYER-1",
    payeeId: "serviceos",
    amount: serviceFeeMinor,
    currency: "NGN",
    escrow: true,
    reference: "life-svc-1",
  });
  assert.equal(payment.status, "escrow_held");
  escrowId = payment.paymentId;

  const res = await app.inject({
    method: "POST",
    url: "/internal/serviceos/dispatch",
    headers: { authorization: "Bearer portal-e2e-token" },
    payload: {
      sourceDomain: "lifeos",
      tenantId,
      orderId: "life_ord_harbor_1",
      category: "barber",
      offeringSku: "CUT-HOME",
      priority: "express",
      escrowId,
      serviceFee: serviceFeeMinor,
      customer: {
        lat: 6.4541,
        lng: 3.3947,
        addressLine1: "12 Marina",
        city: "Lagos",
        country: "NG",
        contactName: "Ada Buyer",
        contactPhone: "+2348011111111",
      },
      buyer: {
        trustId: "TD-BUYER-1",
        name: "Ada Buyer",
        phone: "+2348011111111",
        email: "ada@example.com",
      },
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json() as {
    jobId: string;
    serviceJobId: string;
    status: string;
    otpCode: string;
    trackingUrl: string;
    providerId: string | null;
    serviceFeeMinor: number;
    transportationJobId: string | null;
  };
  assert.equal(body.jobId, body.serviceJobId);
  assert.match(body.otpCode, /^\d{4}$/);
  assert.match(body.trackingUrl, new RegExp(`/service/${body.jobId}`));
  assert.equal(body.serviceFeeMinor, serviceFeeMinor);
  assert.ok(["UNASSIGNED", "OFFERED"].includes(body.status));
  jobId = body.jobId;
  otpCode = body.otpCode;

  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  assert.ok(job);
  assert.equal(job!.status, "OFFERED");
  assert.equal(job!.sourceDomain, "lifeos");
  assert.equal(job!.orderId, "life_ord_harbor_1");
  assert.equal(job!.escrowId, escrowId);
  assert.equal(job!.otpCode, otpCode);
  assert.equal(job!.providerId, providerId);
  assert.equal(job!.category, "barber");
  assert.ok(job!.transportationJobId);

  const sms = getLocalElfCom()!.sent.filter((m) => m.channel === "sms");
  assert.ok(sms.some((m) => m.body.includes(body.trackingUrl) && m.body.includes(otpCode)));

  const tos = getLocalTransportation();
  assert.ok(tos);
  assert.ok(tos.movements.some((m) => m.serviceJobId === jobId));
});

test("4. provider job acceptance and location ping updates modifying live ETA", async () => {
  const headers = { "x-provider-id": providerId };

  const offer = await app.inject({ method: "GET", url: "/v1/provider/offer", headers });
  assert.equal(offer.statusCode, 200, offer.body);
  const offerBody = offer.json() as { offer: { jobId: string; earningsMinor: number; distanceKm: number } | null };
  assert.ok(offerBody.offer);
  assert.equal(offerBody.offer!.jobId, jobId);
  assert.equal(offerBody.offer!.earningsMinor, providerPayoutMinor);

  const accepted = await app.inject({
    method: "POST",
    url: `/v1/jobs/${jobId}/accept`,
    headers,
    payload: { providerId },
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().job.status, "ACCEPTED");

  const enRoute = await app.inject({
    method: "POST",
    url: `/v1/jobs/${jobId}/advance`,
    headers,
    payload: { action: "start_navigation", providerId },
  });
  assert.equal(enRoute.statusCode, 200, enRoute.body);
  assert.equal(enRoute.json().job.status, "EN_ROUTE");

  const before = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  assert.ok(before);
  const etaBefore = before!.etaMinutes ?? 999;

  const ping = await app.inject({
    method: "POST",
    url: "/v1/provider/location",
    payload: { providerId, lat: 6.458, lng: 3.393 },
  });
  assert.equal(ping.statusCode, 200, ping.body);
  const pingBody = ping.json() as {
    job: { jobId: string; etaMinutes: number; lastEtaMinutes: number | null } | null;
  };
  assert.ok(pingBody.job);
  assert.equal(pingBody.job!.jobId, jobId);
  assert.notEqual(pingBody.job!.etaMinutes, etaBefore);
  assert.ok(pingBody.job!.etaMinutes < etaBefore);

  const track = await app.inject({ method: "GET", url: `/v1/track/${jobId}` });
  assert.equal(track.statusCode, 200, track.body);
  const trackBody = track.json() as { otpCode: string; provider: { lat: number }; etaMinutes: number };
  assert.equal(trackBody.otpCode, otpCode);
  assert.equal(trackBody.provider.lat, 6.458);
});

test("5. service completion with OTP, Sovereign Drive photo, and FundzMan payout", async () => {
  const { getLocalFundzMan, getLocalStorage, getLocalWebhooks } = await import(
    "../src/services/register-primitives.ts"
  );
  const headers = { "x-provider-id": providerId };

  const arrive = await app.inject({
    method: "POST",
    url: `/v1/jobs/${jobId}/advance`,
    headers,
    payload: { action: "arrive", providerId },
  });
  assert.equal(arrive.statusCode, 200, arrive.body);
  assert.equal(arrive.json().job.status, "ARRIVED");

  const start = await app.inject({
    method: "POST",
    url: `/v1/jobs/${jobId}/advance`,
    headers,
    payload: { action: "start_service", providerId },
  });
  assert.equal(start.statusCode, 200, start.body);
  assert.equal(start.json().job.status, "IN_SERVICE");

  const pos = await app.inject({
    method: "POST",
    url: `/v1/jobs/${jobId}/pos`,
    headers,
    payload: { imageBase64: POS_PNG, contentType: "image/png", providerId },
  });
  assert.equal(pos.statusCode, 200, pos.body);
  const posBody = pos.json() as { posImageUrl: string; storage: { key: string; url: string } };
  assert.match(posBody.posImageUrl, /^drive:\/\//);
  const stored = await getLocalStorage()!.get({ namespace: "serviceos", key: posBody.storage.key });
  assert.ok(stored);
  assert.ok(stored!.body.byteLength > 0);

  const badOtp = await app.inject({
    method: "POST",
    url: `/v1/jobs/${jobId}/complete`,
    headers,
    payload: { otpCode: "0000", providerId },
  });
  assert.equal(badOtp.statusCode, 401);

  const complete = await app.inject({
    method: "POST",
    url: `/v1/jobs/${jobId}/complete`,
    headers,
    payload: {
      otpCode,
      posImageUrl: posBody.posImageUrl,
      providerId,
    },
  });
  assert.equal(complete.statusCode, 200, complete.body);
  const done = complete.json() as { status: string; payout: { release: { releaseId: string; splits: unknown[] } } };
  assert.equal(done.status, "COMPLETED");
  assert.ok(done.payout.release.releaseId);

  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  assert.equal(job!.status, "COMPLETED");
  assert.ok(job!.settledAt);
  assert.equal(job!.posImageUrl, posBody.posImageUrl);

  const fundz = getLocalFundzMan()!;
  const providerWallet = await fundz.getWalletSummary(providerWalletId);
  const ledger = await fundz.getWalletSummary("lifeos-master-ledger");
  assert.equal(providerWallet.available, providerPayoutMinor);
  assert.equal(ledger.available, platformCommissionMinor);
  assert.ok(fundz.releases.some((r) => r.paymentId === escrowId));
  const release = fundz.releases.find((r) => r.paymentId === escrowId)!;
  assert.equal(release.status, "settled");
  assert.equal(release.splits.find((s) => s.role === "rider")?.amount, providerPayoutMinor);
  assert.equal(release.splits.find((s) => s.role === "platform")?.amount, platformCommissionMinor);

  const hooks = getLocalWebhooks()!.sent;
  assert.ok(hooks.some((h) => h.status === "EN_ROUTE" && h.orderId === "life_ord_harbor_1"));
  assert.ok(hooks.some((h) => h.status === "ARRIVED"));
  assert.ok(hooks.some((h) => h.status === "IN_SERVICE"));
  assert.ok(hooks.some((h) => h.status === "COMPLETED" && h.serviceJobId === jobId));
});
