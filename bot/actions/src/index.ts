
import * as core from "@actions/core";

interface ActionResult {
  message: string;
  status: "success" | "failed";
}

async function run(): Promise<void> {
  try {
    const name = core.getInput("name", {
      required: true,
    });

    const environment =
      core.getInput("environment") || "development";

    core.info(`Running action for ${name}`);
    core.info(`Environment: ${environment}`);
    core.info(`Node version: ${process.version}`);

    const result: ActionResult = {
      message: `Successfully executed ${name} in ${environment}`,
      status: "success",
    };

    core.setOutput("message", result.message);
    core.setOutput("status", result.status);

    core.info(result.message);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);

    core.setOutput("status", "failed");
    core.setFailed(message);
  }
}

void run();
