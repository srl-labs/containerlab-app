import { configureStandaloneBackend } from "@srl-labs/containerlab-standalone-runtime/backend";
import { createSandboxTransport } from "./sandboxTransport";

configureStandaloneBackend(createSandboxTransport());
void import("@srl-labs/containerlab-standalone-runtime/web-main");
