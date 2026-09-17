import { bootstrapInspectWebview } from "@containerlab/clab-ui/inspect";
import { createClabUiRuntime, createWindowClabUiHost } from "@containerlab/clab-ui/host";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

bootstrapInspectWebview(runtime);
