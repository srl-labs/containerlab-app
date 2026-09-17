// Readers, writers and file-change refreshes must not observe a partial save.
// Hosts for the same document share the queue; settled queues release their keys.
const pendingByDocument = new Map<string, Promise<unknown>>();

export function runDocumentOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingByDocument.get(key) ?? Promise.resolve();
  const pending = previous.then(operation, operation);
  pendingByDocument.set(key, pending);
  const release = () => {
    if (pendingByDocument.get(key) === pending) pendingByDocument.delete(key);
  };
  void pending.then(release, release);
  return pending;
}
