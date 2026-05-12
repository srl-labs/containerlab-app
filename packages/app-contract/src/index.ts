export interface EndpointSessionMetadata {
  id: string;
  label: string;
  sessionDuration: string;
  url: string;
  username: string;
}

export interface AppConfigResponse {
  defaultClabApiUrl: string;
  endpoints: EndpointSessionMetadata[];
}
