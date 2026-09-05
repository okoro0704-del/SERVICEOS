/**
 * LifeOS Core Shell primitives (Phase F) — vendored into ServiceOS so the
 * domain shell consumes `@lifeos/shared` without a sibling monorepo link.
 */
export * from "./primitives/index.js";

/** Canonical LifeOS Core Shell primitive ids (Phase F — 6 engines). */
export const LIFEOS_PRIMITIVE_IDS = [
  "trust-id",
  "elfcom",
  "sovereign-drive",
  "platform-jobs",
  "master-distributor",
  "fundzman",
] as const;

export type LifeOsPrimitiveId = (typeof LIFEOS_PRIMITIVE_IDS)[number];

export const LIFEOS_VERSION = "1.9.0";
