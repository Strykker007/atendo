export const QUEUE_INBOUND = 'wa-inbound';
export const QUEUE_OUTBOUND = 'wa-outbound';
export const QUEUE_BILLING = 'billing';

export interface InboundJob {
  provider: 'meta' | 'evolution';
  body: unknown;
}
export interface OutboundJob {
  messageId: string;
}
