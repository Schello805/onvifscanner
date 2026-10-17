// Canonical webpush implementation shared with backend scripts
// eslint-disable-next-line
const wp = require("../../scripts/webpush");

export type PushSubscriptionKey = {
  p256dh: string;
  auth: string;
};

export type PushSubscriptionData = {
  endpoint: string;
  keys: PushSubscriptionKey;
  userAgent?: string;
  subscribedAt?: string;
};

export const getVapidPublicKey: () => string = wp.getVapidPublicKey;
export const loadSubscriptions: () => PushSubscriptionData[] = wp.loadSubscriptions;
export const addSubscription: (
  sub: { endpoint: string; keys: PushSubscriptionKey },
  userAgent?: string
) => { ok: boolean; total: number } = wp.addSubscription;
export const removeSubscription: (endpoint: string) => boolean = wp.removeSubscription;
export const hasSubscriptions: () => boolean = wp.hasSubscriptions;
export const sendWebPushNotification: (options: {
  title?: string;
  body?: string;
  icon?: string;
  image?: string | null;
  url?: string;
  tag?: string;
}) => Promise<{ sentCount: number; failedCount: number; total: number }> =
  wp.sendWebPushNotification;
