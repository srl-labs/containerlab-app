import * as vscode from "vscode";

import { dockerClient, outputChannel } from "../../globals";
import { backendFor } from "../../backend/labBackends";
import { LOCAL_CONNECTION, type LabConnection } from "../../backend/connections";
import { ImagePullPolicy } from "../consts";

// Internal helper to pull the docker image using dockerode client
export async function pullDockerImage(
  image: string,
  connection: LabConnection = LOCAL_CONNECTION
): Promise<boolean> {
  return vscode.window.withProgress<boolean>(
    {
      location: vscode.ProgressLocation.Notification,
      title:
        connection.kind === "api"
          ? `Pulling ${image} on ${connection.label}`
          : `Pulling Docker image ${image}`,
      cancellable: false
    },
    async () => {
      outputChannel.info(`Pulling image ${image}`);
      try {
        if (connection.kind === "api") {
          // The lab host pulls the image for its own container runtime.
          const result = await backendFor(connection).pullImage(image);
          if (!result.success) throw new Error(result.message ?? result.output ?? "pull failed");
          vscode.window.showInformationMessage(`Successfully pulled image '${image}'`);
          return true;
        }
        const stream = await dockerClient.pull(image);
        await new Promise<void>((resolve, reject) => {
          dockerClient.modem.followProgress(stream, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        vscode.window.showInformationMessage(`Successfully pulled image '${image}'`);
        outputChannel.info(`Successfully pulled image '${image}'`);
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        outputChannel.error(`Failed to pull image '${image}': ${message}`);
        vscode.window.showErrorMessage(`Failed to pull image '${image}': ${message}`);
        return false;
      }
    }
  );
}

// Checks if docker image is available locally, and handles the pull policy
export async function checkAndPullDockerImage(
  image: string,
  imagePullPolicy: ImagePullPolicy
): Promise<boolean> {
  outputChannel.debug(`Checking docker image '${image}'`);

  // Check if image exists locally
  let imageExists = false;
  try {
    await dockerClient.getImage(image).inspect();
    imageExists = true;
    outputChannel.debug(`Docker image '${image}' found locally`);
  } catch {
    outputChannel.debug(`Docker image '${image}' not found locally`);
  }

  if (!imageExists) {
    switch (imagePullPolicy) {
      case ImagePullPolicy.Never:
        outputChannel.debug(
          `Pull policy is 'never', skipping image pull for missing image ${image}`
        );
        break;

      case ImagePullPolicy.Missing:
        outputChannel.debug(`Pull policy is 'missing', Pulling missing image '${image}'`);
        imageExists = await pullDockerImage(image);
        break;

      case ImagePullPolicy.Always:
        outputChannel.debug(`Pull policy is 'always', Pulling missing image '${image}'`);
        imageExists = await pullDockerImage(image);
        break;

      default:
        break;
    }
  } else if (imagePullPolicy === ImagePullPolicy.Always) {
    outputChannel.debug(`Pull policy is 'always', Pulling available image '${image}'`);
    imageExists = await pullDockerImage(image);
  }

  return imageExists;
}
