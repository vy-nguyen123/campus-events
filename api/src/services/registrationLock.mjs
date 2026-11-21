const pending = new Map();

// One process owns this SQLite database on Render Free. Queue checks + insert,
// but release before SMTP so slow email does not block the next registration.
export async function withRegistrationLock(eventId, action) {
  const key = Number(eventId);
  const previous = pending.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  pending.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (pending.get(key) === current) pending.delete(key);
  }
}
