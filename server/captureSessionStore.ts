const endpointByCaptureSession = new Map<string, string>();

export function setCaptureSessionEndpoint(sessionId: string, endpointId: string): void {
  const sessionKey = sessionId.trim();
  const endpointKey = endpointId.trim();
  if (!sessionKey || !endpointKey) {
    return;
  }
  endpointByCaptureSession.set(sessionKey, endpointKey);
}

export function getCaptureSessionEndpoint(sessionId: string): string | undefined {
  const sessionKey = sessionId.trim();
  if (!sessionKey) {
    return undefined;
  }
  return endpointByCaptureSession.get(sessionKey);
}

export function deleteCaptureSessionEndpoint(sessionId: string): void {
  const sessionKey = sessionId.trim();
  if (!sessionKey) {
    return;
  }
  endpointByCaptureSession.delete(sessionKey);
}
