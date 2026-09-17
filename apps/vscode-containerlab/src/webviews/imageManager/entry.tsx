import { bootstrapImageManagerWebview } from "@containerlab/clab-ui/image-manager";
import { createClabUiRuntime, createWindowClabUiHost } from "@containerlab/clab-ui/host";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

bootstrapImageManagerWebview(runtime);
