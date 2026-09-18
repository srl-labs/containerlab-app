import {
  parseEndpointProfiles,
  serializeEndpointProfiles,
  type EndpointImportResult
} from "../endpointTransfer";
import { SANDBOX_ENDPOINT } from "../sandboxBackend";
import {
  useEndpointStore,
  type EndpointConfig,
  type EndpointSessionDuration
} from "../stores/endpointStore";

// The public sandbox always runs against a single fixed in-browser endpoint.
// There is no real auth/config/endpoint network I/O: every operation resolves
// to the local workspace endpoint. References below are module-level so the
// returned values keep stable identities across renders.
const SANDBOX_ENDPOINT_LIST: EndpointConfig[] = [SANDBOX_ENDPOINT];
const SANDBOX_ENDPOINTS: Map<string, EndpointConfig> = new Map([
  [SANDBOX_ENDPOINT.id, SANDBOX_ENDPOINT]
]);

useEndpointStore.getState().addEndpoint(SANDBOX_ENDPOINT);

async function resolveSandboxEndpoint(_input?: unknown): Promise<EndpointConfig> {
  return SANDBOX_ENDPOINT;
}

async function noopAsync(): Promise<void> {}

function noop(): void {}

function exportSandboxEndpoints(): string {
  return serializeEndpointProfiles(useEndpointStore.getState().endpoints.values());
}

function importSandboxEndpoints(content: string): EndpointImportResult {
  return useEndpointStore.getState().importProfiles(parseEndpointProfiles(content));
}

async function removeSandboxEndpoint(_endpointId: string): Promise<void> {}

function setSandboxEndpointSessionDuration(
  _endpointId: string,
  _sessionDuration: EndpointSessionDuration
): void {}

export function useEndpointAuth() {
  return {
    addEndpoint: resolveSandboxEndpoint,
    defaultApiUrl: "",
    endpointList: SANDBOX_ENDPOINT_LIST,
    endpoints: SANDBOX_ENDPOINTS,
    error: null as string | null,
    exportEndpoints: exportSandboxEndpoints,
    forgetAllEndpoints: noop,
    hasConnectedEndpoint: true,
    hasEndpointSession: true,
    importEndpoints: importSandboxEndpoints,
    isAuthenticated: true,
    loading: false,
    logout: noopAsync,
    reconnectEndpoint: resolveSandboxEndpoint,
    refreshConfig: noopAsync,
    refreshEndpoints: noopAsync,
    removeEndpoint: removeSandboxEndpoint,
    updateEndpoint: resolveSandboxEndpoint,
    setEndpointSessionDuration: setSandboxEndpointSessionDuration
  };
}

export const useAuth = useEndpointAuth;
