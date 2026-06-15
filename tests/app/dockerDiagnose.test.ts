import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger.ts";
import { runDockerDiagnoseCommand } from "../../src/app/dockerDiagnose.ts";

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

const createStdout = () => {
  let output = "";

  return {
    get output() {
      return output;
    },
    write(chunk: string) {
      output += chunk;
    }
  };
};

const createComposeRunner = (responses: Record<string, { exitCode: number; stdout: string; stderr: string }>) => ({
  run(args: string[]) {
    const key = args.join(" ");
    const response = responses[key];

    if (!response) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `missing mock for ${key}`
      };
    }

    return response;
  }
});

const createHttpProbeRunner = (
  responses: Record<string, { ok: boolean; statusCode: number | null; body?: Record<string, unknown>; error?: string }>
) => ({
  async probe(url: string) {
    return (
      responses[url] ?? {
        ok: false,
        statusCode: null,
        error: `missing mock for ${url}`
      }
    );
  }
});

describe("docker diagnose command", () => {
  it("diagnoses the Cloud Compose service on the loopback-only port", async () => {
    const probeScript = (path: string) =>
      `exec -T legalbot-whatsapp-cloud node -e const path = process.argv[1];fetch(\`http://127.0.0.1:3002\${path}\`)  .then(async (response) => {    let body;    try { body = await response.json(); } catch { body = undefined; }    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));  })  .catch((error) => {    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));  }); ${path}`;
    const readyBody = {
      transport: "cloud",
      state: "ready",
      ready: true,
      signatureVerification: "enforced"
    };
    const composeResponses: Record<
      string,
      { exitCode: number; stdout: string; stderr: string }
    > = {
      "ps --format json": {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            Service: "legalbot-whatsapp-cloud",
            State: "running",
            Health: "healthy"
          }
        ]),
        stderr: ""
      },
      "port legalbot-whatsapp-cloud 3002": {
        exitCode: 0,
        stdout: "127.0.0.1:3002\n",
        stderr: ""
      }
    };

    for (const path of ["/health", "/ready", "/status"]) {
      composeResponses[probeScript(path)] = {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          statusCode: 200,
          body:
            path === "/health"
              ? {
                  alive: true,
                  transport: readyBody
                }
              : readyBody
        }),
        stderr: ""
      };
    }

    const summary = await runDockerDiagnoseCommand({
      envSource: {
        WHATSAPP_TRANSPORT: "cloud"
      },
      transportOverride: "cloud",
      logger: createLogger(),
      stdout: createStdout(),
      composeRunner: createComposeRunner(composeResponses),
      httpProbeRunner: createHttpProbeRunner({
        "http://127.0.0.1:3002/health": {
          ok: true,
          statusCode: 200,
          body: {
            alive: true,
            transport: readyBody
          }
        },
        "http://127.0.0.1:3002/ready": {
          ok: true,
          statusCode: 200,
          body: readyBody
        },
        "http://127.0.0.1:3002/status": {
          ok: true,
          statusCode: 200,
          body: readyBody
        }
      })
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.report).toMatchObject({
      diagnosis: {
        code: "app_ready"
      },
      hostPort: "127.0.0.1:3002",
      compose: {
        servicePresent: true,
        running: true,
        health: "healthy",
        hostPortBinding: "127.0.0.1:3002"
      }
    });
  });

  it("prints a sanitized JSON shape", async () => {
    const logger = createLogger();
    const stdout = createStdout();

    const summary = await runDockerDiagnoseCommand({
      logger,
      stdout,
      composeRunner: createComposeRunner({
        "ps --format json": {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              Service: "legalbot",
              State: "running",
              Health: "healthy"
            }
          ]),
          stderr: ""
        },
        [`port legalbot 3001`]: {
          exitCode: 0,
          stdout: "127.0.0.1:3001\n",
          stderr: ""
        },
        [`exec -T legalbot node -e const path = process.argv[1];fetch(\`http://127.0.0.1:3001\${path}\`)  .then(async (response) => {    let body;    try { body = await response.json(); } catch { body = undefined; }    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));  })  .catch((error) => {    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));  }); /health`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            statusCode: 200,
            body: {
              alive: true,
              transport: {
                state: "ready",
                ready: true,
                clientActive: true,
                listenerRegistered: true,
                livenessEnabled: true,
                livenessFailureCount: 0,
                recoveryMode: "manual",
                recoveryInProgress: false
              }
            }
          }),
          stderr: ""
        },
        [`exec -T legalbot node -e const path = process.argv[1];fetch(\`http://127.0.0.1:3001\${path}\`)  .then(async (response) => {    let body;    try { body = await response.json(); } catch { body = undefined; }    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));  })  .catch((error) => {    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));  }); /ready`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            statusCode: 200,
            body: {
              ready: true,
              state: "ready"
            }
          }),
          stderr: ""
        },
        [`exec -T legalbot node -e const path = process.argv[1];fetch(\`http://127.0.0.1:3001\${path}\`)  .then(async (response) => {    let body;    try { body = await response.json(); } catch { body = undefined; }    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));  })  .catch((error) => {    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));  }); /status`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            statusCode: 200,
            body: {
              state: "ready",
              ready: true,
              clientActive: true,
              listenerRegistered: true,
              livenessEnabled: true,
              livenessFailureCount: 0,
              recoveryMode: "manual",
              recoveryInProgress: false,
              lastError:
                "browser path C:\\Users\\Jacopo\\Documents\\legalbot\\openwa-session and +15551234567"
            }
          }),
          stderr: ""
        }
      }),
      httpProbeRunner: createHttpProbeRunner({
        "http://127.0.0.1:3001/health": {
          ok: true,
          statusCode: 200,
          body: {
            alive: true,
            transport: {
              state: "ready",
              ready: true,
              clientActive: true,
              listenerRegistered: true,
              livenessEnabled: true,
              livenessFailureCount: 0,
              recoveryMode: "manual",
              recoveryInProgress: false
            }
          }
        },
        "http://127.0.0.1:3001/ready": {
          ok: true,
          statusCode: 200,
          body: {
            ready: true,
            state: "ready"
          }
        },
        "http://127.0.0.1:3001/status": {
          ok: true,
          statusCode: 200,
          body: {
            state: "ready",
            ready: true,
            clientActive: true,
            listenerRegistered: true,
            livenessEnabled: true,
            livenessFailureCount: 0,
            recoveryMode: "manual",
            recoveryInProgress: false,
            lastError:
              "body hello for +15551234567 at C:\\Users\\Jacopo\\Documents\\legalbot\\openwa-session"
          }
        }
      })
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.report).toMatchObject({
      status: "healthy",
      diagnosis: {
        code: "app_ready"
      },
      compose: {
        running: true,
        health: "healthy",
        hostPortBinding: "127.0.0.1:3001"
      }
    });
    expect(stdout.output).not.toContain("+15551234567");
    expect(stdout.output).not.toContain("openwa-session");
    expect(stdout.output).not.toContain("body hello");
  });

  it("detects host port unreachable while the app is healthy inside the container", async () => {
    const summary = await runDockerDiagnoseCommand({
      logger: createLogger(),
      stdout: createStdout(),
      composeRunner: createComposeRunner({
        "ps --format json": {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              Service: "legalbot",
              State: "running",
              Health: "healthy"
            }
          ]),
          stderr: ""
        },
        [`port legalbot 3001`]: {
          exitCode: 0,
          stdout: "127.0.0.1:3001\n",
          stderr: ""
        },
        [`exec -T legalbot node -e const path = process.argv[1];fetch(\`http://127.0.0.1:3001\${path}\`)  .then(async (response) => {    let body;    try { body = await response.json(); } catch { body = undefined; }    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));  })  .catch((error) => {    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));  }); /health`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            statusCode: 200,
            body: {
              alive: true,
              transport: {
                state: "ready",
                ready: true,
                clientActive: true,
                listenerRegistered: true,
                livenessEnabled: true,
                livenessFailureCount: 0,
                recoveryMode: "manual",
                recoveryInProgress: false
              }
            }
          }),
          stderr: ""
        },
        [`exec -T legalbot node -e const path = process.argv[1];fetch(\`http://127.0.0.1:3001\${path}\`)  .then(async (response) => {    let body;    try { body = await response.json(); } catch { body = undefined; }    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));  })  .catch((error) => {    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));  }); /ready`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            statusCode: 200,
            body: {
              ready: true,
              state: "ready"
            }
          }),
          stderr: ""
        },
        [`exec -T legalbot node -e const path = process.argv[1];fetch(\`http://127.0.0.1:3001\${path}\`)  .then(async (response) => {    let body;    try { body = await response.json(); } catch { body = undefined; }    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));  })  .catch((error) => {    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));  }); /status`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            statusCode: 200,
            body: {
              state: "ready",
              ready: true
            }
          }),
          stderr: ""
        }
      }),
      httpProbeRunner: createHttpProbeRunner({
        "http://127.0.0.1:3001/health": {
          ok: false,
          statusCode: null,
          error: "connect ECONNREFUSED"
        },
        "http://127.0.0.1:3001/ready": {
          ok: false,
          statusCode: null,
          error: "connect ECONNREFUSED"
        },
        "http://127.0.0.1:3001/status": {
          ok: false,
          statusCode: null,
          error: "connect ECONNREFUSED"
        }
      })
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report?.diagnosis).toEqual({
      code: "docker_network_issue",
      summary:
        "The app is healthy inside the container, but host access to 127.0.0.1:3001 failed despite a matching published port."
    });
  });

  it("detects pending WhatsApp auth when ready stays false inside the container", async () => {
    const summary = await runDockerDiagnoseCommand({
      logger: createLogger(),
      stdout: createStdout(),
      composeRunner: createComposeRunner({
        "ps --format json": {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              Service: "legalbot",
              State: "running",
              Health: "healthy"
            }
          ]),
          stderr: ""
        },
        [`port legalbot 3001`]: {
          exitCode: 0,
          stdout: "127.0.0.1:3001\n",
          stderr: ""
        },
        [`exec -T legalbot node -e const path = process.argv[1];fetch(\`http://127.0.0.1:3001\${path}\`)  .then(async (response) => {    let body;    try { body = await response.json(); } catch { body = undefined; }    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));  })  .catch((error) => {    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));  }); /health`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            statusCode: 200,
            body: {
              alive: true,
              transport: {
                state: "starting",
                ready: false,
                clientActive: true,
                listenerRegistered: true,
                livenessEnabled: true,
                livenessFailureCount: 0,
                recoveryMode: "manual",
                recoveryInProgress: false
              }
            }
          }),
          stderr: ""
        },
        [`exec -T legalbot node -e const path = process.argv[1];fetch(\`http://127.0.0.1:3001\${path}\`)  .then(async (response) => {    let body;    try { body = await response.json(); } catch { body = undefined; }    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));  })  .catch((error) => {    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));  }); /ready`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: false,
            statusCode: 503,
            body: {
              ready: false,
              state: "starting"
            }
          }),
          stderr: ""
        },
        [`exec -T legalbot node -e const path = process.argv[1];fetch(\`http://127.0.0.1:3001\${path}\`)  .then(async (response) => {    let body;    try { body = await response.json(); } catch { body = undefined; }    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));  })  .catch((error) => {    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));  }); /status`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            statusCode: 200,
            body: {
              state: "starting",
              ready: false
            }
          }),
          stderr: ""
        }
      }),
      httpProbeRunner: createHttpProbeRunner({
        "http://127.0.0.1:3001/health": {
          ok: true,
          statusCode: 200,
          body: {
            alive: true,
            transport: {
              state: "starting",
              ready: false
            }
          }
        },
        "http://127.0.0.1:3001/ready": {
          ok: false,
          statusCode: 503,
          body: {
            ready: false,
            state: "starting"
          }
        },
        "http://127.0.0.1:3001/status": {
          ok: true,
          statusCode: 200,
          body: {
            state: "starting",
            ready: false
          }
        }
      })
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report?.diagnosis).toEqual({
      code: "app_not_ready_auth_missing",
      summary:
        "The app is alive inside the container, but the selected transport is not ready yet."
    });
  });
});
