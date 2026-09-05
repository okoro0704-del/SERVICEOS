export type MessagingThreadSummary = {
  id: string;
  subject?: string;
  updatedAt?: string;
};

export type MessagingSendInput = {
  ownerTrustId: string;
  threadId: string;
  body: string;
  channel?: "chat" | "sms";
  to?: string;
};

/**
 * Primitive #2 — ElfCom Engine (Messaging, SMS & real-time chat).
 */
export interface IMessagingProvider {
  readonly primitiveId: "elfcom";
  readonly bound: boolean;
  health(): Promise<{ ok: boolean; service?: string }>;
  listThreads(ownerTrustId: string): Promise<MessagingThreadSummary[]>;
  sendMessage(input: MessagingSendInput): Promise<{ messageId: string }>;
  listMessages?(threadId: string): Promise<Array<{ messageId: string; body: string; ownerTrustId: string; channel?: string; createdAt: string }>>;
}
