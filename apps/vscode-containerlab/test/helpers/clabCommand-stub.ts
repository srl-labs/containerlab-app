import type {
  ClabCommand as RealClabCommand,
  LabLifecycleRequest
} from "../../src/commands/clabCommand";

type ClabCommandArgs = ConstructorParameters<typeof RealClabCommand>;

export const instances: ClabCommand[] = [];

export class ClabCommand {
  public readonly args: ClabCommandArgs;
  public request: LabLifecycleRequest | undefined;

  constructor(...args: ClabCommandArgs) {
    this.args = args;
    instances.push(this);
  }

  async run(request?: LabLifecycleRequest): Promise<void> {
    this.request = request;
  }
}
