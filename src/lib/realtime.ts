import { createHmac } from 'node:crypto';
import { env } from '../config/env';
import { logger } from './logger';
import { linkSecret } from './signed-token';

export type RealtimeAudience = 'patient' | 'doctor' | 'staff';

export interface RealtimeConfig {
  url: string;
  key: string;
  topic: string;
}

export function realtimeTopic(audience: RealtimeAudience, id: string) {
  const digest = createHmac('sha256', linkSecret()).update(`${audience}:${id}`).digest('hex').slice(0, 40);
  return `chat-${audience}-${digest}`;
}

export const realtime = {
  config(audience: RealtimeAudience, id: string): RealtimeConfig | null {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
    return { url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY, topic: realtimeTopic(audience, id) };
  },

  async publish(audience: RealtimeAudience, id: string, event: string, payload: Record<string, string>) {
    if (env.NODE_ENV === 'test' || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
    try {
      const response = await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [{ topic: realtimeTopic(audience, id), event, payload, private: false }],
        }),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) logger.warn({ status: response.status }, 'Realtime broadcast was not accepted');
    } catch (err) {
      logger.warn({ err }, 'Realtime broadcast could not be sent');
    }
  },
};
