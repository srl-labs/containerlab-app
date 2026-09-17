/**
 * TopologyHost command queue.
 *
 * Serializes host command execution per session/host scope to keep baseRevision aligned.
 */

const queueByScope = new WeakMap<object, Promise<unknown>>();
const defaultQueueScope = {};

export function enqueueHostCommand<T>(task: () => Promise<T>, scope: object = defaultQueueScope): Promise<T> {
  const activeQueue = queueByScope.get(scope) ?? Promise.resolve();
  const queued = activeQueue.then(task, task);
  queueByScope.set(scope, queued.catch(() => undefined));
  return queued;
}
