import { readFile } from 'node:fs/promises';

import { db } from '../config/database.js';
import { createFirebasePushProvider, deliverPendingPushNotifications } from './notification-push-worker.js';

async function validateFirebaseCredentials() {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is required for the push worker.');
  try {
    JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Firebase service-account file is missing or invalid JSON.');
  }
}

const loopMode = process.argv.includes('--loop') || process.env.WORKER_LOOP === 'true';
const intervalMs = Math.max(Number(process.env.WORKER_INTERVAL_MS ?? '30000') || 30_000, 1_000);

let stopping = false;
let sleepTimer: ReturnType<typeof setTimeout> | undefined;
let wakeSleep: (() => void) | undefined;

function requestStop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Notification push worker received ${signal}; stopping gracefully.`);
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = undefined;
  }
  wakeSleep?.();
}

function sleepInterruptible(ms: number) {
  return new Promise<void>((resolve) => {
    if (stopping) {
      resolve();
      return;
    }
    wakeSleep = () => {
      wakeSleep = undefined;
      resolve();
    };
    sleepTimer = setTimeout(() => {
      sleepTimer = undefined;
      wakeSleep = undefined;
      resolve();
    }, ms);
  });
}

process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

async function main() {
  await validateFirebaseCredentials();
  const provider = createFirebasePushProvider();

  do {
    try {
      const result = await deliverPendingPushNotifications(provider);
      console.log(`Processed ${result.processed} push jobs; delivered ${result.delivered}.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown notification push worker error.';
      console.error(`Notification push worker failed: ${message}`);
      if (!loopMode) {
        process.exitCode = 1;
        break;
      }
    }

    if (loopMode && !stopping) {
      await sleepInterruptible(intervalMs);
    }
  } while (loopMode && !stopping);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown notification push worker error.';
    console.error(`Notification push worker failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
