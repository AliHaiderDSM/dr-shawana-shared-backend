import { AppDataSource } from '../../database/data-source';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptimeSeconds: number;
  timestamp: string;
}

export const healthService = {
  async check(): Promise<HealthStatus> {
    let database: HealthStatus['database'] = 'down';
    try {
      if (AppDataSource.isInitialized) {
        await AppDataSource.query('select 1');
        database = 'up';
      }
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  },
};
