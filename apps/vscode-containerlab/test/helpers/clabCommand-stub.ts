import type { ClabCommand as RealClabCommand } from "../../src/commands/clabCommand";

type ClabCommandArgs = ConstructorParameters<typeof RealClabCommand>;

export const instances: ClabCommand[] = [];

export class ClabCommand {
  public readonly args: ClabCommandArgs;
  public runArgs: string[] | undefined;

  constructor(...args: ClabCommandArgs) {
    this.args = args;
    instances.push(this);
  }

  async run(flags?: string[]): Promise<void> {
    this.runArgs = flags;
  }
}
