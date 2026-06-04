import { exitWithCode, isDirectExecution, runDbMigrateCommand } from "./dbCommandCommon.ts";

if (isDirectExecution(import.meta.url)) {
  exitWithCode(runDbMigrateCommand());
}
