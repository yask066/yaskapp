import { closeDatabaseConnection } from '../config/database.js';
import { bootstrapSuperadmin, parseBootstrapArgs } from './bootstrap-superadmin.js';

const usage = 'Usage: npm run db:bootstrap-superadmin -- --login <email-or-username>';

try {
  const firstOptionIndex = process.argv.findIndex(
    (arg, index) => index > 0 && arg.startsWith('--')
  );
  const args = firstOptionIndex >= 0 ? process.argv.slice(firstOptionIndex) : [];
  const { login } = parseBootstrapArgs(args);
  const result = await bootstrapSuperadmin(login);
  console.log(
    result.status === 'promoted'
      ? `Bootstrapped superadmin: ${result.login} (${result.userId})`
      : `User is already superadmin: ${result.login} (${result.userId})`
  );
} catch (error) {
  console.error(error);
  console.error(usage);
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
