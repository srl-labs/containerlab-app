import { createClabUiRuntime, createWindowClabUiHost } from "@containerlab/clab-ui/host";
import { bootstrapWelcomePage } from "@containerlab/clab-ui/welcome";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

bootstrapWelcomePage(runtime);
