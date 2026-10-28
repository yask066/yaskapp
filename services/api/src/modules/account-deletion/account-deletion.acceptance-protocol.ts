export async function commitJournaledAcceptance(dependencies: {
  writePrepared(): Promise<void>;
  commitDatabase(): Promise<void>;
  writeAccepted(): Promise<void>;
}) {
  await dependencies.writePrepared();
  await dependencies.commitDatabase();
  await dependencies.writeAccepted();
}
