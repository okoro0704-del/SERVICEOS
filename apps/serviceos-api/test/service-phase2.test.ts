/**
 * ServiceOS Phase 2 — customer booking, shell preset icons, 4-preset provision, live track HTML.
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
  SERVICEOS_PRESET_META,
  categoriesForPreset,
  serviceosPresetIcon,
  type ServiceOSPreset,
} from "../../../packages/shared/src/manifest/serviceos.manifest.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const testDbPath = path.join(apiRoot, "prisma", `serviceos-phase2-${process.pid}.db`);

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:./serviceos-phase2-${process.pid}.db`;
process.env.INTERNAL_PROVISION_TOKEN = "portal-e2e-token";
process.env.PRIMITIVES_MODE = "local";
process.env.WEBHOOK_MODE = "local";
process.env.TRANSPORTATION_MODE = "local";
process.env.SOS_SKIP_PRODUCTION_ASSERT = "true";
process.env.TRACKING_PUBLIC_URL = "https://track.lifeos.app/service/{jobId}";

const PRESETS: ServiceOSPreset[] = ["beauty", "wellness", "technical", "culinary"];

let app: FastifyInstance;
let prisma: PrismaClient;
let tenantId = "";
let bookingId = "";
let otpCode = "";

before(async () => {
  for (const file of [testDbPath, `${testDbPath}-journal`, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
  execSync("npx prisma db push --skip-generate", {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: `file:./serviceos-phase2-${process.pid}.db`, NODE_ENV: "test" },
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

test("1. customer booking from /embed/catalog with automated travel fee", async () => {
  const provision = await app.inject({
    method: "POST",
    url: "/internal/distributor/provision",
    headers: { authorization: "Bearer portal-e2e-token" },
    payload: {
      tenantId: `tid_beauty_${Date.now().toString(36)}`,
      subdomain: `beauty-${Date.now().toString(36)}`,
      displayName: "Harbor Grooming",
      seed: "default",
      preset: "beauty",
      tariffs: { perKmFeeMinor: 12_000 },
    },
  });
  assert.equal(provision.statusCode, 201, provision.body);
  tenantId = provision.json().tenantId as string;

  const catalog = await app.inject({ method: "GET", url: `/embed/catalog?tenantId=${tenantId}` });
  assert.equal(catalog.statusCode, 200);
  assert.match(catalog.headers["content-type"] ?? "", /text\/html/);
  assert.match(catalog.body, /data-testid="service-catalog"/);
  assert.match(catalog.body, /data-testid="quote-travel"/);
  assert.match(catalog.body, /ASAP Dispatch/);

  const quote = await app.inject({
    method: "POST",
    url: "/v1/bookings/quote",
    payload: { tenantId, offeringSku: "CUT-HOME", lat: 6.4541, lng: 3.3947 },
  });
  assert.equal(quote.statusCode, 200, quote.body);
  const quoted = quote.json() as {
    baseFeeMinor: number;
    travelFeeMinor: number;
    totalMinor: number;
    distanceKm: number;
    perKmFeeMinor: number;
  };
  assert.ok(quoted.baseFeeMinor > 0);
  assert.ok(quoted.travelFeeMinor > 0);
  assert.equal(quoted.travelFeeMinor, Math.round(quoted.distanceKm * quoted.perKmFeeMinor));
  assert.equal(quoted.totalMinor, quoted.baseFeeMinor + quoted.travelFeeMinor);

  const book = await app.inject({
    method: "POST",
    url: "/v1/bookings",
    payload: {
      tenantId,
      offeringSku: "CUT-HOME",
      scheduleMode: "asap",
      customer: {
        lat: 6.4541,
        lng: 3.3947,
        addressLine1: "12 Marina",
        city: "Lagos",
        accessNotes: "Gate 4, second floor",
        gateCode: "4411",
      },
      buyer: { trustId: "TD-BUYER-1", name: "Ada Buyer", phone: "+2348011111111" },
    },
  });
  assert.equal(book.statusCode, 201, book.body);
  const body = book.json() as {
    bookingId: string;
    otpCode: string;
    travelFeeMinor: number;
    baseFeeMinor: number;
    serviceFeeMinor: number;
    trackingPath: string;
  };
  bookingId = body.bookingId;
  otpCode = body.otpCode;
  assert.match(otpCode, /^\d{4}$/);
  assert.equal(body.travelFeeMinor, quoted.travelFeeMinor);
  assert.equal(body.serviceFeeMinor, quoted.totalMinor);
  assert.equal(body.trackingPath, `/track/booking/${bookingId}`);
});

test("2. shell projection icons for all ServiceOS presets", async () => {
  assert.equal(serviceosPresetIcon("beauty"), "✂️");
  assert.equal(serviceosPresetIcon("wellness"), "💆");
  assert.equal(serviceosPresetIcon("technical"), "🛠️");
  assert.equal(serviceosPresetIcon("culinary"), "👨‍🍳");
  assert.equal(SERVICEOS_PRESET_META.beauty.tag, "Beauty");
});

test("3. Portal provisioning of all 4 ServiceOS presets", async () => {
  for (const preset of PRESETS) {
    const res = await app.inject({
      method: "POST",
      url: "/internal/distributor/provision",
      headers: { authorization: "Bearer portal-e2e-token" },
      payload: {
        tenantId: `tid_${preset}_${Date.now().toString(36)}`,
        subdomain: `${preset}-${Date.now().toString(36)}`,
        displayName: SERVICEOS_PRESET_META[preset].displayName,
        seed: "default",
        preset,
        studioSettings: {
          cancellationWindowMinutes: 45,
          requireSkillCertifications: true,
          requireProofOfServicePhoto: true,
        },
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json() as {
      preset: string;
      studio: { preset: string; requireProofOfServicePhoto: boolean; offeringsSeeded: number };
      providers: Array<{ skill: string }>;
    };
    assert.equal(body.preset, preset);
    assert.equal(body.studio.preset, preset);
    assert.equal(body.studio.requireProofOfServicePhoto, true);
    const allowed = categoriesForPreset(preset);
    assert.ok(body.studio.offeringsSeeded >= 1);
    for (const p of body.providers) {
      assert.ok(allowed.includes(p.skill as (typeof allowed)[number]), `${p.skill} not in ${preset}`);
    }
  }
});

test("4. customer live tracking page renders provider coords, PIN, and ElfCom", async () => {
  const page = await app.inject({ method: "GET", url: `/track/booking/${bookingId}` });
  assert.equal(page.statusCode, 200, page.body);
  assert.match(page.headers["content-type"] ?? "", /text\/html/);
  assert.match(page.body, /data-testid="live-tracking"/);
  assert.match(page.body, /data-testid="doorstep-pin"/);
  for (const digit of otpCode.split("")) {
    assert.match(page.body, new RegExp(`<span>${digit}</span>`));
  }
  assert.match(page.body, /data-testid="provider-coords"/);
  assert.match(page.body, /data-provider-lat="[0-9.]+"/);
  assert.match(page.body, /data-testid="elfcom-bridge"/);
  assert.match(page.body, /ElfCom/);
  assert.match(page.body, /data-testid="eta-banner"/);
  assert.match(page.body, /TransportationOS telemetry/);
});
