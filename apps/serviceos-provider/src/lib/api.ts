export const API_BASE = import.meta.env.VITE_API_URL ?? "";

export type Provider = {
  id: string;
  code: string;
  displayName: string;
  phone: string;
  skill: string;
  status: string;
  lat: number;
  lng: number;
  walletUserId: string;
};

export type JobView = {
  jobId: string;
  status: string;
  category?: string;
  etaMinutes: number | null;
  earningsMinor?: number;
  earningsFormatted?: string;
  providerPayoutMinor?: number;
  serviceFeeMinor?: number;
  distanceKm: number;
  offerExpiresAt?: string | null;
  navUrl?: string;
  customer: { lat: number; lng: number; addressLine1: string; city: string };
  otpCode?: string;
  posImageUrl?: string | null;
};

export type WalletSummary = {
  userId: string;
  currency: string;
  available: number;
  pending: number;
  formattedAvailable: string;
};

const providerKey = "sos.providerId";

export function getProviderId(): string | null {
  return localStorage.getItem(providerKey);
}

export function setProviderId(id: string) {
  localStorage.setItem(providerKey, id);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const providerId = getProviderId();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(providerId ? { "x-provider-id": providerId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${path}`);
  }
  return (await res.json()) as T;
}
