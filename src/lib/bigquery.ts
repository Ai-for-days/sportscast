import { BigQuery } from '@google-cloud/bigquery';

let bigqueryClient: BigQuery | null = null;

export function getBigQueryClient(): BigQuery | null {
  if (bigqueryClient) return bigqueryClient;

  const credentialsBase64 = import.meta.env.GCP_CREDENTIALS_BASE64;
  const projectId = import.meta.env.GCP_PROJECT_ID;

  if (!credentialsBase64 || !projectId) {
    console.warn('BigQuery credentials not configured — using mock data');
    return null;
  }

  try {
    const credentials = JSON.parse(
      Buffer.from(credentialsBase64, 'base64').toString('utf-8')
    );

    bigqueryClient = new BigQuery({
      projectId,
      credentials,
    });

    return bigqueryClient;
  } catch (err) {
    console.error('Failed to initialize BigQuery client:', err);
    return null;
  }
}

export function getWeatherNextTable(): string {
  return import.meta.env.BIGQUERY_DATASET || 'bigquery-public-data.weathernext.sample';
}

export function isMockMode(): boolean {
  return getBigQueryClient() === null;
}
