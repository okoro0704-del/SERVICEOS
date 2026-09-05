import type {
  BillPaymentPayload,
  DeliveryOtpIssueInput,
  DeliveryOtpIssueResult,
  DriverLicenseProof,
  DriverLicenseVerifyInput,
  EscrowReleasePayload,
  EscrowReleaseResult,
  IFundzManWalletProvider,
  IJobDispatcher,
  IMasterDistributorClient,
  IMessagingProvider,
  IStorageProvider,
  ITrustIdProvider,
  InitiatePaymentPayload,
  JobEnqueueInput,
  MessagingSendInput,
  PaymentResult,
  StorageObjectRef,
  TrustIdSessionProof,
  WalletBalanceSummary,
  WalletTransferPayload,
  WalletTransferResult,
  WalletWithdrawPayload,
} from "@lifeos/shared";
import { formatMinor } from "@serviceos/shared";
import { randomInt, randomUUID } from "node:crypto";

export class LocalTrustIdAdapter implements ITrustIdProvider {
  readonly primitiveId = "trust-id" as const;
  readonly bound = true;
  readonly otps = new Map<string, { otpCode: string; expiresAt: string }>();

  async health() {
    return { ok: true, service: "trustid-local" };
  }

  async resolveSession(sessionToken: string): Promise<TrustIdSessionProof | null> {
    if (!sessionToken) return null;
    const trustId = sessionToken.startsWith("TD-") ? sessionToken : `TD-${sessionToken}`;
    return { trustId, sessionToken, trustTier: 1, verified: true };
  }

  async issueDeliveryOtp(input: DeliveryOtpIssueInput): Promise<DeliveryOtpIssueResult> {
    const otpCode = String(randomInt(0, 10_000)).padStart(4, "0");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    this.otps.set(input.jobId, { otpCode, expiresAt });
    return { otpCode, expiresAt };
  }

  async verifyDeliveryOtp(input: { jobId: string; otpCode: string }): Promise<boolean> {
    const stored = this.otps.get(input.jobId);
    if (!stored) return false;
    if (new Date(stored.expiresAt).getTime() < Date.now()) return false;
    return stored.otpCode === input.otpCode;
  }

  async verifyDriverLicense(input: DriverLicenseVerifyInput): Promise<DriverLicenseProof> {
    const session = input.sessionToken ? await this.resolveSession(input.sessionToken) : null;
    const trustId = session?.trustId ?? input.customerTrustId;
    if (!trustId) {
      return { verified: false, trustId: "", reason: "missing_trust_id" };
    }
    if (input.licenseNumber && /^FAIL/i.test(input.licenseNumber)) {
      return { verified: false, trustId, licenseNumber: input.licenseNumber, reason: "license_rejected" };
    }
    return {
      verified: true,
      trustId,
      licenseClass: "B",
      licenseNumber: input.licenseNumber ?? "VERIFIED",
    };
  }
}

type StoredMessage = MessagingSendInput & { messageId: string; createdAt: string };

export class LocalElfComMessagingAdapter implements IMessagingProvider {
  readonly primitiveId = "elfcom" as const;
  readonly bound = true;
  readonly sent: StoredMessage[] = [];

  async health() {
    return { ok: true, service: "elfcom-local" };
  }

  async listThreads(ownerTrustId: string) {
    const ids = [...new Set(this.sent.filter((m) => m.ownerTrustId === ownerTrustId).map((m) => m.threadId))];
    return ids.map((id) => ({ id, updatedAt: new Date().toISOString() }));
  }

  async sendMessage(input: MessagingSendInput) {
    const messageId = `local_msg_${randomUUID()}`;
    this.sent.push({ ...input, messageId, createdAt: new Date().toISOString() });
    return { messageId };
  }

  async listMessages(threadId: string) {
    return this.sent.filter((m) => m.threadId === threadId);
  }
}

export class LocalSovereignDriveAdapter implements IStorageProvider {
  readonly primitiveId = "sovereign-drive" as const;
  readonly bound = true;
  readonly store = new Map<string, { body: Uint8Array; contentType?: string }>();

  async health() {
    return { ok: true, service: "sovereign-drive-local" };
  }

  async put(input: {
    namespace: string;
    key: string;
    body: Uint8Array | string;
    contentType?: string;
  }): Promise<StorageObjectRef> {
    const body = typeof input.body === "string" ? Buffer.from(input.body) : input.body;
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    this.store.set(`${input.namespace}:${input.key}`, { body: bytes, contentType: input.contentType });
    return {
      namespace: input.namespace,
      key: input.key,
      contentType: input.contentType,
      sizeBytes: bytes.byteLength,
      url: `drive://${input.namespace}/${input.key}`,
    };
  }

  async get(input: { namespace: string; key: string }) {
    return this.store.get(`${input.namespace}:${input.key}`) ?? null;
  }
}

type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export class LocalJobDispatcherAdapter implements IJobDispatcher {
  readonly primitiveId = "platform-jobs" as const;
  readonly bound = true;
  readonly jobs = new Map<string, { status: string; type: string; payload: Record<string, unknown> }>();
  readonly handlers = new Map<string, JobHandler>();

  registerHandler(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async health() {
    return { ok: true, service: "platform-jobs-local" };
  }

  async enqueue(input: JobEnqueueInput) {
    const jobId = `local_job_${randomUUID()}`;
    this.jobs.set(jobId, { status: input.delayMs ? "scheduled" : "queued", type: input.type, payload: input.payload });
    const run = async () => {
      const handler = this.handlers.get(input.type);
      try {
        if (handler) await handler(input.payload);
        const j = this.jobs.get(jobId);
        if (j) j.status = "completed";
      } catch {
        const j = this.jobs.get(jobId);
        if (j) j.status = "failed";
      }
    };
    if (input.delayMs && input.delayMs > 0) {
      const timer = setTimeout(() => void run(), input.delayMs);
      timer.unref();
      return { jobId, status: "scheduled" as const };
    }
    queueMicrotask(() => void run());
    return { jobId, status: "queued" as const };
  }

  async getStatus(jobId: string) {
    return { jobId, status: this.jobs.get(jobId)?.status ?? "unknown" };
  }
}

export class LocalMasterDistributorClient implements IMasterDistributorClient {
  readonly primitiveId = "master-distributor" as const;
  readonly bound = true;
  readonly deploys: Array<{ shellId: string; artifactTag: string; deploymentId: string; url?: string }> = [];
  private seq = 0;

  async health() {
    return { ok: true, service: "master-distributor-local" };
  }

  async requestDeploy(input: { shellId: string; artifactTag: string; environment?: "staging" | "production" }) {
    this.seq += 1;
    const deploymentId = `local_dep_${this.seq}`;
    const slug = input.artifactTag.replace(/^tenant:/, "");
    const url = `https://${slug}.lifeos.app`;
    this.deploys.push({ ...input, deploymentId, url });
    return { deploymentId, status: "accepted" as const, url };
  }

  async getDeployment(deploymentId: string) {
    const found = this.deploys.find((d) => d.deploymentId === deploymentId);
    return { deploymentId, status: "accepted" as const, url: found?.url };
  }
}

type WalletRow = { available: number; pending: number; currency: string };

export class LocalFundzManAdapter implements IFundzManWalletProvider {
  readonly primitiveId = "fundzman" as const;
  readonly bound = true;
  readonly intents = new Map<string, { amount: number; currency: string; status: string; payerTrustId: string }>();
  readonly releases: EscrowReleaseResult[] = [];
  readonly transfers: WalletTransferResult[] = [];
  readonly withdrawals: Array<{ withdrawalId: string; userId: string; amount: number; status: string }> = [];
  readonly wallets = new Map<string, WalletRow>();
  private seq = 0;

  private wallet(userId: string, currency = "NGN"): WalletRow {
    const existing = this.wallets.get(userId);
    if (existing) return existing;
    const created: WalletRow = { available: 0, pending: 0, currency };
    this.wallets.set(userId, created);
    return created;
  }

  async health() {
    return { ok: true, service: "fundzman-local" };
  }

  async initiatePayment(payload: InitiatePaymentPayload): Promise<PaymentResult> {
    this.seq += 1;
    const paymentId = `local_pay_${this.seq}`;
    const status = payload.escrow ? "escrow_held" : "authorized";
    this.intents.set(paymentId, {
      amount: payload.amount,
      currency: payload.currency,
      status,
      payerTrustId: payload.payerTrustId,
    });
    return {
      paymentId,
      status,
      amount: payload.amount,
      currency: payload.currency,
      receiptId: `local_rcpt_${this.seq}`,
      message: "local fundzman stub",
    };
  }

  async billPassThrough(payload: BillPaymentPayload): Promise<PaymentResult> {
    this.seq += 1;
    return {
      paymentId: `local_bill_${this.seq}`,
      status: "settled",
      amount: payload.amount,
      currency: payload.currency,
      receiptId: `local_bill_rcpt_${this.seq}`,
      message: "local bill pass-through",
    };
  }

  async getWalletSummary(userId: string): Promise<WalletBalanceSummary> {
    const w = this.wallet(userId);
    return {
      userId,
      currency: w.currency,
      available: w.available,
      pending: w.pending,
      formattedAvailable: formatMinor(w.available, w.currency),
    };
  }

  async credit(payload: { userId: string; amount: number; currency: string; reason?: string }) {
    const w = this.wallet(payload.userId, payload.currency);
    w.available += payload.amount;
    w.currency = payload.currency;
    return this.getWalletSummary(payload.userId);
  }

  async releaseEscrow(payload: EscrowReleasePayload): Promise<EscrowReleaseResult> {
    const intent = this.intents.get(payload.paymentId);
    if (intent && intent.status !== "escrow_held") {
      throw Object.assign(new Error("No escrow to release"), { statusCode: 409, code: "escrow_not_held" });
    }
    if (intent) {
      const splitSum = payload.splits.reduce((s, x) => s + x.amount, 0);
      if (splitSum !== intent.amount) {
        throw Object.assign(new Error("Split sum does not match escrow amount"), {
          statusCode: 400,
          code: "split_mismatch",
        });
      }
      intent.status = "settled";
    }
    for (const split of payload.splits) {
      await this.credit({ userId: split.payeeId, amount: split.amount, currency: payload.currency, reason: split.role });
    }
    const result: EscrowReleaseResult = {
      releaseId: `local_rel_${++this.seq}`,
      paymentId: payload.paymentId,
      status: "settled",
      splits: payload.splits,
    };
    this.releases.push(result);
    return result;
  }

  async transfer(payload: WalletTransferPayload): Promise<WalletTransferResult> {
    const from = this.wallet(payload.fromWalletId, payload.currency);
    if (from.available < payload.amount) {
      from.available += payload.amount;
    }
    from.available -= payload.amount;
    const to = this.wallet(payload.toWalletId, payload.currency);
    to.available += payload.amount;
    const result: WalletTransferResult = {
      transferId: `local_xfer_${++this.seq}`,
      status: "settled",
      fromWalletId: payload.fromWalletId,
      toWalletId: payload.toWalletId,
      amount: payload.amount,
      currency: payload.currency,
    };
    this.transfers.push(result);
    return result;
  }

  async withdraw(payload: WalletWithdrawPayload) {
    const w = this.wallet(payload.userId, payload.currency);
    if (w.available < payload.amount) {
      throw Object.assign(new Error("Insufficient wallet balance"), { statusCode: 409, code: "insufficient_funds" });
    }
    w.available -= payload.amount;
    const withdrawal = {
      withdrawalId: `local_wd_${++this.seq}`,
      userId: payload.userId,
      amount: payload.amount,
      status: "settled" as const,
    };
    this.withdrawals.push(withdrawal);
    return withdrawal;
  }
}
