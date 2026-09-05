import { config } from "../config.js";

export type ServiceWebhookStatus = "EN_ROUTE" | "ARRIVED" | "IN_SERVICE" | "COMPLETED";

export type SourceWebhookPayload = {
  serviceJobId: string;
  orderId: string;
  status: ServiceWebhookStatus;
  occurredAt?: string;
  sourceDomain: string;
};

export interface ISourceWebhookClient {
  notify(payload: SourceWebhookPayload): Promise<{ ok: boolean; skipped?: boolean }>;
}

let client: ISourceWebhookClient | null = null;

export function setSourceWebhookClient(next: ISourceWebhookClient): void {
  client = next;
}

export function getSourceWebhookClient(): ISourceWebhookClient {
  if (!client) throw new Error("Source webhook client not registered");
  return client;
}

export class LocalSourceWebhookClient implements ISourceWebhookClient {
  readonly sent: SourceWebhookPayload[] = [];
  async notify(payload: SourceWebhookPayload) {
    this.sent.push(payload);
    return { ok: true };
  }
}

export class RemoteSourceWebhookClient implements ISourceWebhookClient {
  async notify(payload: SourceWebhookPayload) {
    const path =
      payload.sourceDomain === "hospitalityos"
        ? "/internal/hospitality/webhooks/service-update"
        : "/internal/lifeos/webhooks/service-update";
    const base = payload.sourceDomain === "hospitalityos" ? config.hospitalityOsUrl : config.lifeOsUrl;
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.internalProvisionToken}`,
      },
      body: JSON.stringify({
        serviceJobId: payload.serviceJobId,
        orderId: payload.orderId,
        status: payload.status,
        occurredAt: payload.occurredAt ?? new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw Object.assign(new Error(`Source webhook failed: ${res.status} ${text}`), {
        statusCode: 502,
        code: "source_webhook_failed",
      });
    }
    return { ok: true };
  }
}
