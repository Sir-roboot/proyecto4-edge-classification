#!/usr/bin/env node

/** Read-only contrast of five Raspberry captures, the deployed API and S3. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const baseUrl = (process.env.P4_API_BASE_URL ?? 'https://dmpbp69umccrl.cloudfront.net').replace(/\/$/, '');
const bucket = process.env.P4_CAPTURE_BUCKET ?? 'edge-captures-dev-685538571046';
const region = process.env.AWS_REGION ?? 'us-east-1';
const profile = process.argv.includes('--profile')
  ? process.argv[process.argv.indexOf('--profile') + 1]
  : undefined;

if (process.argv.includes('--profile') && !profile) {
  throw new Error('Uso: node scripts/verify-p4-3-2-readonly.mjs [--profile nombre]');
}

const ids = [
  '06f73767-d72c-4552-9205-d46d06d49d47',
  '1567eff4-4e97-4b40-8a40-eb12e17fa4c9',
  '7a3c8ec2-00d1-449f-8fef-37312a8be1bc',
  'de22fa19-2685-4ef1-8b3b-aeeeffc0491e',
  'f2e6765a-260f-4dd7-ab72-ea82ffe96ad3',
];

const edgeRows = readFileSync(new URL('../docs/evidence/p4-2-4/operation-log.jsonl', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const sendSummary = readFileSync(new URL('../docs/evidence/p4-3-1/aws-sends-summary.txt', import.meta.url), 'utf8');

async function get(url, kind = 'json') {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) {
    throw new Error(`${response.status} al consultar ${url}`);
  }
  return kind === 'bytes' ? Buffer.from(await response.arrayBuffer()) : response.json();
}

function s3ContentLength(key) {
  const args = [
    's3api', 'head-object', '--region', region, '--bucket', bucket,
    '--key', key, '--query', 'ContentLength', '--output', 'text',
  ];
  if (profile) args.push('--profile', profile);
  return Number(execFileSync('aws', args, { encoding: 'utf8' }).trim());
}

async function main() {
  const list = await get(`${baseUrl}/api/edge-captures?limit=100&offset=0`);
  if (!Array.isArray(list.captures)) throw new Error('La API no devolvió una lista de capturas.');

  const results = [];
  for (const id of ids) {
    const summaryLine = sendSummary.split(/\r?\n/).find((line) => line.startsWith(id));
    const summaryKey = summaryLine?.match(/edge-captures\/\S+\.jpg/)?.[0];
    const localHash = summaryKey?.match(/\/([0-9a-f]{64})\.jpg$/)?.[1];
    const edge = edgeRows.find((row) => row.image_sha256 === localHash);
    const listed = list.captures.find((capture) => capture.capture_id === id);
    if (!summaryKey || !edge || !listed) throw new Error(`Falta evidencia local o listado para ${id}`);

    const detail = await get(`${baseUrl}/api/edge-captures/${id}`);
    const image = await get(`${baseUrl}/api/edge-captures/${id}/image`, 'bytes');
    const imageHash = createHash('sha256').update(image).digest('hex');
    const s3Bytes = s3ContentLength(detail.image_key);
    const photoToEventSeconds = Math.round(
      (Date.parse(detail.captured_at) - Date.parse(edge.captured_at)) / 1000,
    );
    const checks = {
      sameId: detail.capture_id === id && listed.capture_id === id,
      sameClass: detail.predicted_class === edge.predicted_class && listed.predicted_class === edge.predicted_class,
      sameConfidence: Math.abs(detail.confidence - edge.confidence) < 0.000001,
      sameModel: detail.model_version === edge.model_version,
      sameImageKey: detail.image_key === summaryKey && listed.image_key === summaryKey,
      sameImageSha256: detail.image_sha256 === localHash && imageHash === localHash,
      sameImageBytes: image.length === s3Bytes,
      sameApiEventTime: listed.captured_at === detail.captured_at,
    };
    results.push({
      capture_id: id,
      class: detail.predicted_class,
      confidence: detail.confidence,
      device_id: detail.device_id,
      photo_captured_at: edge.captured_at,
      event_captured_at: detail.captured_at,
      photo_to_event_seconds: photoToEventSeconds,
      image_sha256: imageHash,
      image_bytes: image.length,
      checks,
      passes: Object.values(checks).every(Boolean),
    });
  }

  const report = {
    checked_at: new Date().toISOString(),
    api_base_url: baseUrl,
    s3_bucket: bucket,
    count: results.length,
    passes: results.length === 5 && results.every((row) => row.passes),
    note: 'photo_captured_at y event_captured_at difieren: el cliente reclasificó fotos existentes antes de enviarlas; no se exige igualdad entre esos dos instantes.',
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.passes) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
