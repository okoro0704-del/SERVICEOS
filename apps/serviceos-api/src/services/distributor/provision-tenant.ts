import { createHash } from "node:crypto";
import { SERVICEOS_DEFAULT_MODULES, SERVICEOS_MANIFEST, normalizeServiceOSPreset, type ServiceOSPreset } from "@serviceos/shared";
import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { httpError } from "../../lib/crypto.js";
import { writeAudit } from "../../lib/audit.js";
import { seedStudioDefaults } from "./provision-seed.js";
import { getDistributorProvider, getLifeOsPrimitives } from "../lifeos/container.js";

export type ProvisionTenantInput = {
  distributorTenantId: string;
  tenantId?: string;
  subdomain: string;
  slug?: string;
  displayName: string;
  customDomain?: string;
  brand?: { primaryColor?: string; logoUrl?: string };
  oauthDestinations?: string[];
  modules?: string[];
  seed?: "default" | "none";
  trustId?: { audience?: string; businessPublicId?: string };
  organization?: { slug?: string; name?: string };
  manifestVersion?: string;
  hq?: {
    addressLine1?: string;
    city?: string;
    country?: string;
    lat?: number;
    lng?: number;
  };
  defaultCurrency?: string;
  tariffs?: {
    basePriceMinor?: number;
    perKmFeeMinor?: number;
    platformCommissionBps?: number;
    categoryMultipliers?: Record<string, number>;
  };
  preset?: ServiceOSPreset | string;
  studioSettings?: {
    cancellationWindowMinutes?: number;
    requireSkillCertifications?: boolean;
    requireProofOfServicePhoto?: boolean;
  };
};

function launchUrl(template: string, subdomain: string): string {
  return template.replaceAll("{subdomain}", subdomain);
}

export async function provisionServiceTenant(input: ProvisionTenantInput) {
  const slug = (input.slug ?? input.subdomain).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const seedMode = input.seed ?? "default";
  const modules = input.modules?.length ? input.modules : [...SERVICEOS_DEFAULT_MODULES];

  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    throw httpError(409, "conflict", `Tenant slug already exists: ${slug}`);
  }

  const primitives = getLifeOsPrimitives();
  const primitiveBindings = {
    "trust-id": { bound: primitives.trustId.bound, audience: input.trustId?.audience ?? config.trustidAudience },
    elfcom: { bound: primitives.messaging.bound },
    "sovereign-drive": { bound: primitives.storage.bound },
    "platform-jobs": { bound: primitives.jobs.bound },
    "master-distributor": { bound: primitives.distributor.bound },
    fundzman: { bound: primitives.wallet.bound },
  };

  const deploy = await getDistributorProvider().requestDeploy({
    shellId: "serviceos",
    artifactTag: `tenant:${slug}`,
    environment: config.env === "production" ? "production" : "staging",
  });

  const orgSlug = input.organization?.slug ?? `${slug}-studio`.replace(/[^a-z0-9-]/g, "-");
  const organization = await prisma.organization.upsert({
    where: { slug: orgSlug },
    create: {
      slug: orgSlug,
      name: input.organization?.name ?? `${input.displayName} Studio`,
      status: "active",
      metadata: { distributorTenantId: input.distributorTenantId },
    },
    update: {
      name: input.organization?.name ?? `${input.displayName} Studio`,
    },
  });

  const tenant = await prisma.tenant.create({
    data: {
      organizationId: organization.id,
      slug,
      name: input.displayName,
      businessType: SERVICEOS_MANIFEST.brandDefaults.businessType,
      status: "active",
      lifeosBusinessId: input.trustId?.businessPublicId ?? input.distributorTenantId,
      logoUrl: input.brand?.logoUrl,
      primaryColor: input.brand?.primaryColor ?? SERVICEOS_MANIFEST.brandDefaults.primaryColor,
      settings: {
        distributorTenantId: input.distributorTenantId,
        customDomain: input.customDomain ?? null,
        oauthDestinations: input.oauthDestinations ?? SERVICEOS_MANIFEST.install.oauthDestinations,
        trustIdAudience: input.trustId?.audience ?? config.trustidAudience,
        manifestVersion: input.manifestVersion ?? SERVICEOS_MANIFEST.version,
        provisionedAt: new Date().toISOString(),
        enabledModules: modules,
        primitiveBindings,
        distributorDeploymentId: deploy.deploymentId,
        preset: input.preset ? normalizeServiceOSPreset(input.preset) : null,
        studioSettings: input.studioSettings ?? null,
        subdomainRouting: {
          provider: launchUrl(config.providerLaunchUrlTemplate, slug),
          tracking: config.trackingLaunchUrlTemplate,
          deploymentUrl: deploy.url ?? null,
        },
      },
    },
  });

  for (const moduleId of modules) {
    await prisma.tenantModule.create({
      data: { tenantId: tenant.id, moduleId, enabled: true, config: {} },
    });
  }

  let seedResult: Awaited<ReturnType<typeof seedStudioDefaults>> | null = null;
  if (seedMode === "default") {
    seedResult = await seedStudioDefaults({
      tenantId: tenant.id,
      displayName: input.displayName,
      subdomain: slug,
      preset: input.preset,
      tariffs: input.tariffs,
      studioSettings: input.studioSettings,
      hq: input.hq,
      defaultCurrency: input.defaultCurrency,
    });
  }

  await writeAudit({
    tenantId: tenant.id,
    actorKind: "system",
    action: "distributor.provision",
    resource: "tenant",
    resourceId: tenant.id,
    metadata: {
      distributorTenantId: input.distributorTenantId,
      slug,
      modules,
      seed: seedMode,
      fingerprint: createHash("sha256").update(`${slug}:${tenant.id}`).digest("hex").slice(0, 16),
    },
  });

  const providerConsoleUrl = launchUrl(config.providerLaunchUrlTemplate, slug);

  return {
    ok: true as const,
    tenantId: tenant.id,
    providerConsoleUrl,
    trackingUrl: config.trackingLaunchUrlTemplate,
    organizationId: organization.id,
    slug: tenant.slug,
    modulesEnabled: modules,
    seedApplied: seedMode === "default",
    primitiveBindings,
    preset: seedResult?.preset ?? (input.preset ? normalizeServiceOSPreset(input.preset) : null),
    studio: seedResult
      ? {
          id: seedResult.studio.id,
          preset: seedResult.preset,
          basePriceMinor: seedResult.studio.basePriceMinor,
          perKmFeeMinor: seedResult.studio.perKmFeeMinor,
          cancellationWindowMinutes: seedResult.studio.cancellationWindowMinutes,
          requireSkillCertifications: seedResult.studio.requireSkillCertifications,
          requireProofOfServicePhoto: seedResult.studio.requireProofOfServicePhoto,
          categoryMultipliers: seedResult.studio.categoryMultipliers,
          providersSeeded: seedResult.providers.length,
          offeringsSeeded: seedResult.offerings.length,
        }
      : null,
    providers: seedResult?.providers.map((p) => ({
      id: p.id,
      code: p.code,
      displayName: p.displayName,
      skill: p.skill,
      status: p.status,
    })),
    launchUrls: {
      provider: providerConsoleUrl,
      tracking: config.trackingLaunchUrlTemplate,
    },
    subdomainRouting: deploy.url ?? providerConsoleUrl,
  };
}
