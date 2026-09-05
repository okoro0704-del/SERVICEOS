import { PrismaClient } from "@prisma/client";
import { provisionServiceTenant } from "../src/services/distributor/provision-tenant.ts";
import { registerLocalPrimitiveProvidersOrRemote } from "../src/services/register-primitives.ts";

registerLocalPrimitiveProvidersOrRemote();

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.tenant.findUnique({ where: { slug: "harbor-studio" } });
  if (existing) {
    console.log("Seed skipped — harbor-studio already exists");
    return;
  }
  const result = await provisionServiceTenant({
    distributorTenantId: "tid_harbor_studio",
    subdomain: "harbor-studio",
    displayName: "Harbor Studio",
    seed: "default",
  });
  console.log("Seeded", result.slug, result.tenantId);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
