import type { CmdOptions } from "../../src/commands/command";

export const instances: Command[] = [];

export class Command {
  public readonly options: CmdOptions;
  public executedArgs: string[] | undefined;

  constructor(options: CmdOptions) {
    this.options = options;
    instances.push(this);
  }

  execute(args?: string[]): Promise<void> {
    this.executedArgs = args;
    return Promise.resolve();
  }
}
