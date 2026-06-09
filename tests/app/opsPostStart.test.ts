import { describe, expect, it } from "vitest";
import { runOpsPostStartCommand } from "../../src/app/opsPostStart.ts";

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

describe("ops post-start command", () => {
  it("prints a sanitized ready report for direct mode", async () => {
    const stdout = createStdout();

    const summary = await runOpsPostStartCommand({
      envSource: {
        LAWYER_PHONE_E164: "+15551234567",
        OPENWA_STATUS_SERVER_ENABLED: "true",
        OPENWA_STATUS_SERVER_HOST: "127.0.0.1",
        OPENWA_STATUS_SERVER_PORT: "3001"
      },
      httpProbeRunner: {
        async probe(url: string) {
          if (url.endsWith("/health")) {
            return {
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
            };
          }

          if (url.endsWith("/ready")) {
            return {
              ok: true,
              statusCode: 200,
              body: {
                ready: true,
                state: "ready"
              }
            };
          }

          return {
            ok: true,
            statusCode: 200,
            body: {
              state: "ready",
              ready: true,
              lastError:
                "message body for +15551234567 in C:\\Users\\Jacopo\\Documents\\legalbot\\openwa-session"
            }
          };
        }
      },
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.report).toMatchObject({
      status: "healthy",
      mode: "direct",
      diagnosis: {
        code: "app_ready"
      },
      statusServerEnabled: true,
      docker: {
        reusedDockerDiagnose: false,
        compose: null
      }
    });
    expect(stdout.output).not.toContain("+15551234567");
    expect(stdout.output).not.toContain("openwa-session");
    expect(stdout.output).not.toContain("message body");
  });

  it("reports pending auth in direct mode", async () => {
    const summary = await runOpsPostStartCommand({
      envSource: {
        LAWYER_PHONE_E164: "+15551234567",
        OPENWA_STATUS_SERVER_ENABLED: "true",
        OPENWA_STATUS_SERVER_HOST: "127.0.0.1",
        OPENWA_STATUS_SERVER_PORT: "3001"
      },
      httpProbeRunner: {
        async probe(url: string) {
          if (url.endsWith("/health")) {
            return {
              ok: true,
              statusCode: 200,
              body: {
                alive: true,
                transport: {
                  state: "starting",
                  ready: false
                }
              }
            };
          }

          if (url.endsWith("/ready")) {
            return {
              ok: false,
              statusCode: 503,
              body: {
                ready: false,
                state: "starting"
              }
            };
          }

          return {
            ok: true,
            statusCode: 200,
            body: {
              state: "starting",
              ready: false
            }
          };
        }
      }
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report.diagnosis).toEqual({
      code: "app_not_ready_auth_missing",
      summary:
        "The app is alive, but WhatsApp authentication or QR pairing is still pending."
    });
  });

  it("reports host reachability problems in direct mode", async () => {
    const summary = await runOpsPostStartCommand({
      envSource: {
        LAWYER_PHONE_E164: "+15551234567",
        OPENWA_STATUS_SERVER_ENABLED: "true",
        OPENWA_STATUS_SERVER_HOST: "127.0.0.1",
        OPENWA_STATUS_SERVER_PORT: "3001"
      },
      httpProbeRunner: {
        async probe() {
          return {
            ok: false,
            statusCode: null,
            error: "connect ECONNREFUSED"
          };
        }
      }
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report.diagnosis).toEqual({
      code: "host_port_mapping_issue",
      summary:
        "The local status surface is not reachable or did not expose the expected ready state."
    });
  });

  it("reuses docker diagnose when docker mode is requested", async () => {
    const summary = await runOpsPostStartCommand({
      envSource: {
        LAWYER_PHONE_E164: "+15551234567",
        OPENWA_STATUS_SERVER_ENABLED: "true",
        OPENWA_STATUS_SERVER_HOST: "127.0.0.1",
        OPENWA_STATUS_SERVER_PORT: "3001",
        OPS_POST_START_MODE: "docker"
      },
      dockerDiagnoseRunner: async () => ({
        exitCode: 1,
        report: {
          status: "warning",
          diagnosis: {
            code: "app_not_ready_auth_missing",
            summary:
              "The app is alive inside the container, but WhatsApp authentication or QR pairing is still pending."
          },
          checkedAt: "2026-06-09T10:00:00.000Z",
          hostPort: "127.0.0.1:3001",
          compose: {
            servicePresent: true,
            running: true,
            state: "running",
            health: "healthy",
            hostPortBinding: "127.0.0.1:3001"
          },
          host: {
            health: {
              reachable: true,
              statusCode: 200
            },
            ready: {
              reachable: true,
              statusCode: 503,
              body: {
                ready: false,
                state: "starting"
              }
            },
            status: {
              reachable: true,
              statusCode: 200,
              body: {
                state: "starting",
                ready: false
              }
            }
          },
          inContainer: {
            health: {
              reachable: true,
              statusCode: 200
            },
            ready: {
              reachable: true,
              statusCode: 503,
              body: {
                ready: false,
                state: "starting"
              }
            },
            status: {
              reachable: true,
              statusCode: 200,
              body: {
                state: "starting",
                ready: false
              }
            }
          }
        }
      })
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report).toMatchObject({
      mode: "docker",
      diagnosis: {
        code: "app_not_ready_auth_missing"
      },
      docker: {
        reusedDockerDiagnose: true,
        compose: {
          servicePresent: true,
          running: true,
          state: "running",
          health: "healthy"
        }
      }
    });
  });
});
