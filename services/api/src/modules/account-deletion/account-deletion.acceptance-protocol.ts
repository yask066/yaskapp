export async function commitJournaledAcceptance(dependencies: {
  writePrepared(): Promise<void>;
  commitDatabase(): Promise<void>;
  writeAccepted(): Promise<void>;
  writeAborted?: () => Promise<void>;
}) {
  await dependencies.writePrepared();
  try {
    await dependencies.commitDatabase();
  } catch (error) {
    await dependencies.writeAborted?.().catch(() => undefined);
    throw error;
  }
  await dependencies.writeAccepted();
}
