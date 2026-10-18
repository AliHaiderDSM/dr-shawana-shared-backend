import { logger } from './logger';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface PushTicket {
  status?: string;
  details?: { error?: string };
}

export async function sendExpoPush(tokens: string[], message: PushMessage): Promise<string[]> {
  const valid = tokens.filter((t) => /^Expo(nent)?PushToken\[.+\]$/.test(t));
  if (valid.length === 0) return [];
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(
        valid.map((to) => ({
          to,
          title: message.title,
          body: message.body,
          data: message.data,
          sound: 'default',
          priority: 'high',
          channelId: 'messages',
        })),
      ),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Push notification was not accepted');
      return [];
    }
    const result = (await response.json().catch(() => null)) as { data?: PushTicket[] } | null;
    const tickets = Array.isArray(result?.data) ? result.data : [];
    return valid.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
  } catch (err) {
    logger.warn({ err }, 'Push notification could not be sent');
    return [];
  }
}
