import { checkDatabaseConnection, closeDatabaseConnection } from '../config/database.js';

try {
  const database = await checkDatabaseConnection();
  console.log(`Database connected. Server time: ${database.serverTime}`);
} catch (error) {
  console.error('Database connection failed.');
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
