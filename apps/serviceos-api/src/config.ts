export type AppEnv = "development" | "test" | "production";

export function resolveAppEnv(): AppEnv {
  const raw = (process.env.SOS_ENV ?? process.env.NODE_ENV ?? "development").toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  if (raw === "test") return "test";
  return "development";
}

const appEnv = resolveAppEnv();

export const config = {
  env: appEnv,
  port: Number(process.env.SOS_PORT ?? 8920),
  host: process.env.SOS_HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? (appEnv === "production" ? "" : "file:./dev.db"),
  corsOrigins: (
    process.env.CORS_ORIGINS ??
    "http://localhost:5194,http://127.0.0.1:5194,http://localhost:5174,http://127.0.0.1:5174"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  trustidApiUrl: process.env.TRUSTID_API_URL ?? "http://localhost:8791",
  trustidAudience: process.env.TRUSTID_AUDIENCE ?? "serviceos",
  primitivesMode: (process.env.PRIMITIVES_MODE ?? "local").toLowerCase() as "local" | "remote",
  transportationMode: (process.env.TRANSPORTATION_MODE ?? "local").toLowerCase() as "local" | "remote",
  transportationOsUrl: process.env.TRANSPORTATIONOS_URL ?? "http://localhost:8910",
  elfcomUrl: process.env.ELFCOM_URL ?? "http://localhost:4000",
  sovereignDriveUrl: process.env.SOVEREIGN_DRIVE_URL ?? "http://localhost:4100",
  platformJobsUrl: process.env.PLATFORM_JOBS_URL ?? "http://localhost:3000",
  masterDistributorUrl: process.env.MASTER_DISTRIBUTOR_URL ?? "http://localhost:3100",
  fundzmanUrl: process.env.FUNDZMAN_URL ?? "http://localhost:4200",
  lifeOsUrl: process.env.LIFEOS_URL ?? "http://localhost:8790",
  hospitalityOsUrl: process.env.HOSPITALITYOS_URL ?? "http://localhost:8800",
  primitivesServiceToken: process.env.PRIMITIVES_SERVICE_TOKEN ?? "dev-primitives-token",
  internalProvisionToken:
    process.env.INTERNAL_PROVISION_TOKEN ??
    process.env.PRIMITIVES_SERVICE_TOKEN ??
    "dev-primitives-token",
  trackingPublicUrlTemplate:
    process.env.TRACKING_PUBLIC_URL ?? "https://track.lifeos.app/service/{jobId}",
  providerLaunchUrlTemplate:
    process.env.PROVIDER_LAUNCH_URL ?? "https://{subdomain}.lifeos.app/provider",
  trackingLaunchUrlTemplate: process.env.TRACKING_LAUNCH_URL ?? "https://track.lifeos.app",
  masterLedgerWalletId: process.env.MASTER_LEDGER_WALLET_ID ?? "lifeos-master-ledger",
  escrowSourceWalletId: process.env.ESCROW_SOURCE_WALLET_ID ?? "lifeos-escrow-pool",
  skipProductionAssert: process.env.SOS_SKIP_PRODUCTION_ASSERT === "true",
  version: "0.1.0",
};
