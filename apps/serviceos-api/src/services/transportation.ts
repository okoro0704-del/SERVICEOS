import { config } from "../config.js";

export type TransportationMovementInput = {
  serviceJobId: string;
  tenantId: string;
  orderId: string;
  origin: { lat: number; lng: number; addressLine1?: string; city?: string };
  destination: { lat: number; lng: number; addressLine1?: string; city?: string };
  escrowId?: string | null;
};

export type TransportationPingInput = {
  serviceJobId: string;
  providerId: string;
  lat: number;
  lng: number;
};

export type TransportationMovementResult = {
  transportationJobId: string;
  etaMinutes: number | null;
  mode: "local" | "remote";
};

export interface ITransportationDispatchClient {
  ingestMovement(input: TransportationMovementInput): Promise<TransportationMovementResult>;
  pingLocation(input: TransportationPingInput): Promise<{ ok: boolean }>;
}

let client: ITransportationDispatchClient | null = null;

export function setTransportationClient(next: ITransportationDispatchClient): void {
  client = next;
}

export function getTransportationClient(): ITransportationDispatchClient {
  if (!client) throw new Error("TransportationOS client not registered");
  return client;
}

/** In-process TransportationOS pipeline — same matching/ETA math lives in ServiceOS. */
export class LocalTransportationClient implements ITransportationDispatchClient {
  readonly movements: TransportationMovementInput[] = [];
  readonly pings: TransportationPingInput[] = [];

  async ingestMovement(input: TransportationMovementInput): Promise<TransportationMovementResult> {
    this.movements.push(input);
    return {
      transportationJobId: `tos_local_${input.serviceJobId}`,
      etaMinutes: null,
      mode: "local",
    };
  }

  async pingLocation(input: TransportationPingInput) {
    this.pings.push(input);
    return { ok: true };
  }
}

export class RemoteTransportationClient implements ITransportationDispatchClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async ingestMovement(input: TransportationMovementInput): Promise<TransportationMovementResult> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/internal/transportation/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        sourceDomain: "serviceos",
        tenantId: input.tenantId,
        orderId: input.orderId,
        escrowId: input.escrowId ?? null,
        pickup: input.origin,
        dropoff: input.destination,
        handlingType: "standard",
        priority: "standard",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw Object.assign(new Error(`TransportationOS dispatch failed: ${res.status} ${text}`), {
        statusCode: 502,
        code: "transportation_dispatch_failed",
      });
    }
    const body = (await res.json()) as { jobId?: string; etaMinutes?: number | null };
    return {
      transportationJobId: body.jobId ?? `tos_remote_${input.serviceJobId}`,
      etaMinutes: body.etaMinutes ?? null,
      mode: "remote",
    };
  }

  async pingLocation(input: TransportationPingInput) {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/rider/location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        riderId: input.providerId,
        lat: input.lat,
        lng: input.lng,
      }),
    });
    if (!res.ok) return { ok: false };
    return { ok: true };
  }
}

export function registerTransportationClient(env: NodeJS.ProcessEnv = process.env): ITransportationDispatchClient {
  const mode = (env.TRANSPORTATION_MODE ?? config.transportationMode ?? "local").toLowerCase();
  const next =
    mode === "remote"
      ? new RemoteTransportationClient(config.transportationOsUrl, config.internalProvisionToken)
      : new LocalTransportationClient();
  setTransportationClient(next);
  return next;
}

export function getLocalTransportation(): LocalTransportationClient | null {
  return client instanceof LocalTransportationClient ? client : null;
}
