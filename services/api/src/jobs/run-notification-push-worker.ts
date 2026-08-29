import { db } from '../config/database.js';
import { createFirebasePushProvider, deliverPendingPushNotifications } from './notification-push-worker.js';

deliverPendingPushNotifications(createFirebasePushProvider())
  .then((result) => console.log(`Processed ${result.processed} push jobs; delivered ${result.delivered}.`))
  .finally(() => db.end());
