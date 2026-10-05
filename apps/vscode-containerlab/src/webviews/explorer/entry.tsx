import { ContainerlabExplorerView } from "@containerlab/clab-ui/explorer";
import { ClabUiRuntimeProvider } from "@containerlab/clab-ui/host";
import { MuiThemeProvider } from "@containerlab/clab-ui/theme";

import { mountWebview, renderWebview } from "../shared/mountWebview";

mountWebview((runtime) =>
  renderWebview(
    <ClabUiRuntimeProvider runtime={runtime}>
      <MuiThemeProvider>
        <ContainerlabExplorerView />
      </MuiThemeProvider>
    </ClabUiRuntimeProvider>
  )
);
