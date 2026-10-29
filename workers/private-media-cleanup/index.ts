interface Environment { HONTO_API_BASE_URL: string; CRON_SECRET: string }
export default {
  async scheduled(_event: unknown, env: Environment): Promise<void> {
    if (!env.CRON_SECRET) throw new Error('CRON_SECRET is required');
    const url = new URL('/api/cron/private-media', env.HONTO_API_BASE_URL);
    if (url.protocol !== 'https:') throw new Error('HTTPS is required');
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(50000),
    });
    if (!response.ok) throw new Error(`Private media cleanup failed: ${response.status}`);
  },
};
