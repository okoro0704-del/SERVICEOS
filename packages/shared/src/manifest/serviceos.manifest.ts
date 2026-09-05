/**
 * ServiceOS app manifest for Master Distributor / LifeOS Portal.
 * On-demand at-home professionals dispatched via TransportationOS telemetry.
 */

export type RequiredLifeOsPrimitive =
  | "identity"
  | "messaging"
  | "storage"
  | "jobs"
  | "distributor"
  | "billing";

export const SERVICE_MODULE_IDS = [
  "studio",
  "catalog",
  "dispatch",
  "matching",
  "telemetry",
  "tracking",
  "settlement",
  "provider_console",
  "billing",
] as const;

export type ModuleId = (typeof SERVICE_MODULE_IDS)[number];

export type ServiceCategory = "barber" | "makeup" | "stylist" | "massage" | "chef" | "technician";
export type ProviderSkill = ServiceCategory;
export type JobPriority = "standard" | "express" | "urgent";
export type SourceDomain = "lifeos" | "hospitalityos" | "ecommerceos";

/** Portal / shell commercial presets for ServiceOS. */
export type ServiceOSPreset = "beauty" | "wellness" | "technical" | "culinary";
export type ServiceOSVerticalTag = "Beauty" | "Wellness" | "Technical" | "Culinary";
export type ServiceOSEmbedTab = "catalog" | "appointments";

export const SERVICEOS_PRESETS = ["beauty", "wellness", "technical", "culinary"] as const satisfies readonly ServiceOSPreset[];

export const SERVICEOS_PRESET_META: Record<
  ServiceOSPreset,
  {
    icon: string;
    tag: ServiceOSVerticalTag;
    embedTab: ServiceOSEmbedTab;
    categories: ServiceCategory[];
    displayName: string;
  }
> = {
  beauty: {
    icon: "✂️",
    tag: "Beauty",
    embedTab: "catalog",
    categories: ["barber", "makeup", "stylist"],
    displayName: "Mobile Salon & Grooming OS",
  },
  wellness: {
    icon: "💆",
    tag: "Wellness",
    embedTab: "catalog",
    categories: ["massage"],
    displayName: "Home Wellness & Spa OS",
  },
  technical: {
    icon: "🛠️",
    tag: "Technical",
    embedTab: "catalog",
    categories: ["technician"],
    displayName: "On-Demand Field Technician OS",
  },
  culinary: {
    icon: "👨‍🍳",
    tag: "Culinary",
    embedTab: "catalog",
    categories: ["chef"],
    displayName: "Private Chef & Culinary OS",
  },
};

export function isServiceOSPreset(value: unknown): value is ServiceOSPreset {
  return value === "beauty" || value === "wellness" || value === "technical" || value === "culinary";
}

export function normalizeServiceOSPreset(value: unknown, fallback: ServiceOSPreset = "beauty"): ServiceOSPreset {
  return isServiceOSPreset(value) ? value : fallback;
}

export function serviceosPresetIcon(preset?: ServiceOSPreset | string | null): string {
  return SERVICEOS_PRESET_META[normalizeServiceOSPreset(preset)].icon;
}

export function serviceosVerticalTag(preset?: ServiceOSPreset | string | null): ServiceOSVerticalTag {
  return SERVICEOS_PRESET_META[normalizeServiceOSPreset(preset)].tag;
}

export function serviceosEmbedPath(preset?: ServiceOSPreset | string | null, tab?: ServiceOSEmbedTab): string {
  const resolved = tab ?? SERVICEOS_PRESET_META[normalizeServiceOSPreset(preset)].embedTab;
  return resolved === "appointments" ? "/embed/appointments" : "/embed/catalog";
}

export function categoriesForPreset(preset?: ServiceOSPreset | string | null): ServiceCategory[] {
  return [...SERVICEOS_PRESET_META[normalizeServiceOSPreset(preset)].categories];
}

export type ServiceJobStatus =
  | "UNASSIGNED"
  | "OFFERED"
  | "ACCEPTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "IN_SERVICE"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export const JOB_PIPELINE: ServiceJobStatus[] = [
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
  "IN_SERVICE",
  "COMPLETED",
];

/** Skill matching — a provider skill may cover one or more catalog categories. */
export const SKILL_SUITABILITY: Record<ServiceCategory, ProviderSkill[]> = {
  barber: ["barber", "stylist"],
  makeup: ["makeup", "stylist"],
  stylist: ["stylist", "barber"],
  massage: ["massage"],
  chef: ["chef"],
  technician: ["technician"],
};

export const JOB_STATUS_TO_WEBHOOK: Record<string, "EN_ROUTE" | "ARRIVED" | "IN_SERVICE" | "COMPLETED" | null> = {
  EN_ROUTE: "EN_ROUTE",
  ARRIVED: "ARRIVED",
  IN_SERVICE: "IN_SERVICE",
  COMPLETED: "COMPLETED",
};

export function formatMinor(amount: number, currency = "NGN"): string {
  const major = amount / 100;
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(major);
  } catch {
    return `${currency} ${major.toFixed(0)}`;
  }
}

export type ProviderSeed = {
  code: string;
  displayName: string;
  phone: string;
  skill: ProviderSkill;
  lat: number;
  lng: number;
};

export type OfferingSeed = {
  sku: string;
  name: string;
  category: ServiceCategory;
  durationMinutes: number;
  priceMinor: number;
};

export type ServiceOsDefaultSeed = {
  roles: Array<{ role: string; label: string }>;
  studio: {
    defaultCurrency: string;
    basePriceMinor: number;
    perKmFeeMinor: number;
    platformCommissionBps: number;
    offerTimeoutSeconds: number;
    hqAddressLine1: string;
    hqCity: string;
    hqCountry: string;
    hqLat: number;
    hqLng: number;
    categoryMultipliers: Record<ServiceCategory, number>;
    travelSpeedsKmh: Record<ProviderSkill, number>;
  };
  providers: ProviderSeed[];
  offerings: OfferingSeed[];
  notificationTemplates: Array<{
    key: string;
    channel: "chat" | "sms";
    subject: string;
    body: string;
  }>;
};

export const SERVICEOS_DEFAULT_MODULES: ModuleId[] = [...SERVICE_MODULE_IDS];

export const SERVICEOS_DEFAULT_SEED: ServiceOsDefaultSeed = {
  roles: [
    { role: "owner", label: "Studio owner" },
    { role: "dispatcher", label: "Dispatcher" },
    { role: "provider", label: "Provider" },
  ],
  studio: {
    defaultCurrency: "NGN",
    basePriceMinor: 150_000,
    perKmFeeMinor: 12_000,
    platformCommissionBps: 1500,
    offerTimeoutSeconds: 30,
    hqAddressLine1: "1 LifeOS Plaza",
    hqCity: "Lagos",
    hqCountry: "NG",
    hqLat: 6.5244,
    hqLng: 3.3792,
    categoryMultipliers: {
      barber: 1,
      makeup: 1.2,
      stylist: 1.15,
      massage: 1.4,
      chef: 1.8,
      technician: 1.3,
    },
    travelSpeedsKmh: {
      barber: 28,
      makeup: 28,
      stylist: 28,
      massage: 26,
      chef: 24,
      technician: 30,
    },
  },
  providers: [
    {
      code: "ADA-BARBER",
      displayName: "Ada Okonkwo",
      phone: "+2348010000001",
      skill: "barber",
      lat: 6.5244,
      lng: 3.3792,
    },
    {
      code: "KELE-MAKEUP",
      displayName: "Kelechi Nwosu",
      phone: "+2348010000002",
      skill: "makeup",
      lat: 6.535,
      lng: 3.39,
    },
    {
      code: "CHI-MASSAGE",
      displayName: "Chioma Eze",
      phone: "+2348010000003",
      skill: "massage",
      lat: 6.51,
      lng: 3.37,
    },
    {
      code: "TUNDE-CHEF",
      displayName: "Tunde Bakare",
      phone: "+2348010000004",
      skill: "chef",
      lat: 6.52,
      lng: 3.36,
    },
    {
      code: "EMEKA-TECH",
      displayName: "Emeka Obi",
      phone: "+2348010000005",
      skill: "technician",
      lat: 6.53,
      lng: 3.385,
    },
  ],
  offerings: [
    { sku: "CUT-HOME", name: "At-home haircut", category: "barber", durationMinutes: 45, priceMinor: 120_000 },
    { sku: "GLAM-HOME", name: "Mobile glam makeup", category: "makeup", durationMinutes: 75, priceMinor: 280_000 },
    { sku: "STYLE-HOME", name: "Personal styling session", category: "stylist", durationMinutes: 60, priceMinor: 200_000 },
    { sku: "MASSAGE-60", name: "House massage (60 min)", category: "massage", durationMinutes: 60, priceMinor: 350_000 },
    { sku: "CHEF-DINNER", name: "Private chef dinner", category: "chef", durationMinutes: 150, priceMinor: 850_000 },
    { sku: "TECH-VISIT", name: "Mobile technician visit", category: "technician", durationMinutes: 90, priceMinor: 220_000 },
  ],
  notificationTemplates: [
    {
      key: "TRACKING_SMS",
      channel: "sms",
      subject: "Your professional is on the way",
      body: "Track your ServiceOS visit: {trackingUrl} PIN: {otpCode}",
    },
    {
      key: "JOB_OFFER",
      channel: "chat",
      subject: "New service offer",
      body: "New at-home job near you. Est. earnings {earnings}. Accept within 30s.",
    },
  ],
};

export type ServiceOSManifest = {
  appId: "serviceos";
  displayName: string;
  version: string;
  description: string;
  distributorPrimitives: Array<"commerce" | "identity" | "billing" | "messaging">;
  requiredPrimitives: RequiredLifeOsPrimitive[];
  defaultModules: ModuleId[];
  defaultSeed: ServiceOsDefaultSeed;
  presets: typeof SERVICEOS_PRESET_META;
  brandDefaults: { primaryColor: string; businessType: "service" };
  transportation: {
    pipeline: "transportationos";
    localAdapter: "in-process matching + ETA";
    remoteDispatchPath: "/internal/transportation/dispatch";
  };
  install: {
    bootstrapPath: "/v1/distributor/tenants/bootstrap";
    hosProvisionPath: "/internal/distributor/provision";
    oauthDestinations: string[];
  };
};

export const SERVICEOS_MANIFEST: ServiceOSManifest = {
  appId: "serviceos",
  displayName: "ServiceOS",
  version: "0.1.0",
  description:
    "On-demand at-home professionals — barbers, makeup artists, stylists, massage, private chefs, and technicians — dispatched with TransportationOS live telemetry.",
  distributorPrimitives: ["commerce", "identity", "billing", "messaging"],
  requiredPrimitives: ["identity", "messaging", "storage", "jobs", "distributor", "billing"],
  defaultModules: SERVICEOS_DEFAULT_MODULES,
  defaultSeed: SERVICEOS_DEFAULT_SEED,
  presets: SERVICEOS_PRESET_META,
  brandDefaults: {
    primaryColor: "#14B8A6",
    businessType: "service",
  },
  transportation: {
    pipeline: "transportationos",
    localAdapter: "in-process matching + ETA",
    remoteDispatchPath: "/internal/transportation/dispatch",
  },
  install: {
    bootstrapPath: "/v1/distributor/tenants/bootstrap",
    hosProvisionPath: "/internal/distributor/provision",
    oauthDestinations: ["https://{subdomain}.lifeos.app/provider", "https://track.lifeos.app"],
  },
};
