import { exitWithCode, isDirectExecution, runDbStatusCommand } from "./dbCommandCommon.ts";

if (isDirectExecution(import.meta.url)) {
  exitWithCode(runDbStatusCommand());
}
