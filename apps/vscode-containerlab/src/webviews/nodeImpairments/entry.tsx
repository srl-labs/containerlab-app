import { createClabUiRuntime, createWindowClabUiHost } from "@containerlab/clab-ui/host";
import { bootstrapNodeImpairmentsWebview } from "@containerlab/clab-ui/node-impairments";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

bootstrapNodeImpairmentsWebview(runtime);
