export type TrustIdSessionProof = {
  trustId: string;
  sessionToken?: string;
  trustTier?: number;
  verified?: boolean;
};

export type DeliveryOtpIssueInput = {
  jobId: string;
  recipientTrustId?: string;
  purpose?: "delivery";
};

export type DeliveryOtpIssueResult = {
  otpCode: string;
  expiresAt: string;
};

export type DriverLicenseVerifyInput = {
  customerTrustId: string;
  licenseNumber?: string;
  sessionToken?: string;
};

export type DriverLicenseProof = {
  verified: boolean;
  trustId: string;
  licenseClass?: string;
  licenseNumber?: string;
  reason?: string;
};

/**
 * Primitive #1 — Trust ID Engine (Identity, biometrics, delivery OTP, driver license).
 */
export interface ITrustIdProvider {
  readonly primitiveId: "trust-id";
  readonly bound: boolean;
  health(): Promise<{ ok: boolean; service?: string }>;
  resolveSession(sessionToken: string): Promise<TrustIdSessionProof | null>;
  issueDeliveryOtp(input: DeliveryOtpIssueInput): Promise<DeliveryOtpIssueResult>;
  verifyDeliveryOtp(input: { jobId: string; otpCode: string }): Promise<boolean>;
  verifyDriverLicense(input: DriverLicenseVerifyInput): Promise<DriverLicenseProof>;
}
