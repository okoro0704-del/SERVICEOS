import type { ProviderSkill } from "@serviceos/shared";

const EARTH_KM = 6371;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function etaMinutesFromKm(distanceKm: number, speedKmh: number): number {
  if (speedKmh <= 0) return 1;
  return Math.max(1, Math.round((distanceKm / speedKmh) * 60));
}

export const DEFAULT_SPEEDS: Record<ProviderSkill, number> = {
  barber: 28,
  makeup: 28,
  stylist: 28,
  massage: 26,
  chef: 24,
  technician: 30,
};

export function quoteTravelFee(distanceKm: number, perKmFeeMinor: number): number {
  return Math.round(distanceKm * perKmFeeMinor);
}

export function quoteBookingBreakdown(opts: {
  distanceKm: number;
  baseFeeMinor: number;
  perKmFeeMinor: number;
}): {
  distanceKm: number;
  baseFeeMinor: number;
  travelFeeMinor: number;
  totalMinor: number;
} {
  const travelFeeMinor = quoteTravelFee(opts.distanceKm, opts.perKmFeeMinor);
  return {
    distanceKm: opts.distanceKm,
    baseFeeMinor: opts.baseFeeMinor,
    travelFeeMinor,
    totalMinor: opts.baseFeeMinor + travelFeeMinor,
  };
}

export function quoteServiceFee(opts: {
  distanceKm: number;
  basePriceMinor: number;
  perKmFeeMinor: number;
  multiplier: number;
}): number {
  const base = Math.round(opts.basePriceMinor * opts.multiplier);
  return base + quoteTravelFee(opts.distanceKm, opts.perKmFeeMinor);
}
