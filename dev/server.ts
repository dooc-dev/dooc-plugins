import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
let port = process.argv[2] ?? "5179";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Invalid preview port");
const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("@sasaki-s-sci/dooc")));
let server: ChildProcess | undefined;
let valid = false, pending = false, restarting = false, stopping = false;

async function restart(): Promise<void> {
  pending = true;
  if (restarting) return;
  restarting = true;
  try {
    while (pending && !stopping) {
      pending = false;
      if (!valid) continue;
      if (stopping || !valid || pending) continue;
      if (server && server.exitCode === null && server.signalCode === null) {
        const exited = once(server, "exit"); server.kill(); await exited;
      }
      if (stopping || !valid || pending) continue;
      server = spawn(process.execPath, [cli, "view", "./dev/content", port, "--viewer-plugins", "./dist/dev/viewer.js"], {
        stdio: ["inherit", "pipe", "inherit"], env: { ...process.env, DOCS_HMR: "1" },
      });
      server.on("error", console.error);
      server.stdout!.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
        // Keep the chosen port across restarts when dooc initially falls back to a free port.
        const selected = /http:\/\/localhost:(\d+)\//.exec(chunk.toString());
        if (selected) port = selected[1];
      });
    }
  } catch (error) { console.error(error); }
  finally { restarting = false; }
}

const host = ts.createWatchCompilerHost("tsconfig.json", { preserveWatchOutput: true }, ts.sys, ts.createEmitAndSemanticDiagnosticsBuilderProgram);
const afterCompile = host.afterProgramCreate!;
host.afterProgramCreate = program => {
  afterCompile(program);
  valid = !ts.getPreEmitDiagnostics(program.getProgram()).some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  if (valid) void restart();
};
const compiler = ts.createWatchProgram(host);
const assets = watch("assets", { recursive: true }, () => { void restart(); });
const stop = () => {
  stopping = true; compiler.close(); assets.close();
  server?.kill();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
