import fs from "node:fs";
import path from "node:path";
import { MontageTaskStore } from "./lib/task-store.js";
import { OpenMontageRunner } from "./lib/runtime-runner.js";

export default class OpenMontagePlugin {
  async onload() {
    const { dataDir, bus, log } = this.ctx;

    const generatedDir = path.join(dataDir, "generated");
    fs.mkdirSync(generatedDir, { recursive: true });

    const store = new MontageTaskStore(dataDir);
    const runner = new OpenMontageRunner({
      dataDir,
      generatedDir,
      store,
      bus,
      log,
      pluginCtx: this.ctx,
    });

    this.ctx._openMontage = { store, runner, generatedDir };

    runner.recoverPending();

    bus.request("task:register-handler", {
      type: "openmontage-generation",
      abort: (taskId) => runner.abort(taskId),
    }).catch(() => {});

    this.register(() => {
      runner.dispose();
      store.destroy();
      bus.request("task:unregister-handler", { type: "openmontage-generation" }).catch(() => {});
      log.info("openmontage plugin unloaded");
    });

    log.info("openmontage plugin loaded");
  }
}
