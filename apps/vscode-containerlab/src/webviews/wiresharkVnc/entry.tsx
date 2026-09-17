import { createClabUiRuntime, createWindowClabUiHost } from "@containerlab/clab-ui/host";
import { bootstrapWiresharkVncWebview } from "@containerlab/clab-ui/wireshark-vnc";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

bootstrapWiresharkVncWebview(runtime);
