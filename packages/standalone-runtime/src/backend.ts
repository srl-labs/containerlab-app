/** The standalone renderer consumes a transport; apps provide its implementation. */
export interface StandaloneBackend {
  fetch: typeof globalThis.fetch;
  capabilities: {
    lifecycle: boolean;
    endpoints: boolean;
    events: boolean;
    repositories: boolean;
    archives: boolean;
  };
  subscribeFiles?: (listener: (endpointId: string) => void) => () => void;
}

const serverBackend: StandaloneBackend = {
  fetch: (input, init) => globalThis.fetch(input, init),
  capabilities: { lifecycle: true, endpoints: true, events: true, repositories: true, archives: true }
};

let backend = serverBackend;

/** Configure before importing/mounting the renderer. Never patches browser globals. */
export function configureStandaloneBackend(next: StandaloneBackend): void {
  backend = next;
}

export function getStandaloneBackend(): StandaloneBackend {
  return backend;
}

export const runtimeFetch: typeof globalThis.fetch = (input, init) => backend.fetch(input, init);
