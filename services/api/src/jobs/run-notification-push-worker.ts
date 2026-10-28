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

validateFirebaseCredentials()
  .then(() => deliverPendingPushNotifications(createFirebasePushProvider()))
  .then((result) => console.log(`Processed ${result.processed} push jobs; delivered ${result.delivered}.`))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown notification push worker error.';
    console.error(`Notification push worker failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
