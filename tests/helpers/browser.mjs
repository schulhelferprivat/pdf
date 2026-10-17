import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
export async function browser(
  t,
  { prefix = "/", viewport = { width: 1440, height: 960 }, reducedMotion = true } = {},
) {
  const root = fileURLToPath(new URL("../../", import.meta.url)),
    profile = await mkdtemp(join(tmpdir(), "pdfhelper-browser-"));
  const overrides = new Map();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (!url.pathname.startsWith(prefix)) throw new Error("Not found");
      const relative =
          decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html",
        path = resolve(root, relative);
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep))
        throw new Error("Invalid path");
      const data = overrides.has(relative)
        ? overrides.get(relative)
        : await readFile(path);
      const extension = path.split(".").at(-1);
      response.setHeader("Cache-Control", "no-store");
      response.setHeader(
        "Content-Type",
        {
          js: "text/javascript",
          mjs: "text/javascript",
          css: "text/css",
          html: "text/html",
          json: "application/json",
          webmanifest: "application/manifest+json",
          wasm: "application/wasm",
          svg: "image/svg+xml",
          png: "image/png",
          ttf: "font/ttf",
        }[extension] || "application/octet-stream",
      );
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const child = spawn(
    process.env.CHROME_BIN || "google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let socket;
  t.after(async () => {
    socket?.close();
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  const endpoint = await new Promise((resolve, reject) => {
    let data = "";
    const timer = setTimeout(
      () => reject(new Error("Browserstart fehlgeschlagen: " + data)),
      15000,
    );
    child.on("error", reject);
    child.stderr.on("data", (chunk) => {
      data += chunk;
      const match = data.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  socket = new WebSocket(endpoint);
  await once(socket, "open");
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const response = JSON.parse(data),
      callback = pending.get(response.id);
    if (callback) {
      pending.delete(response.id);
      callback(response);
    }
  });
  async function command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const key = ++id,
        timer = setTimeout(() => {
          pending.delete(key);
          reject(new Error(`${method} Zeitüberschreitung`));
        }, 45000);
      pending.set(key, (response) => {
        clearTimeout(timer);
        response.error
          ? reject(new Error(JSON.stringify(response.error)))
          : resolve(response.result);
      });
      socket.send(JSON.stringify({ id: key, method, params, sessionId }));
    });
  }
  const { targetId } = await command("Target.createTarget", {
      url: "about:blank",
    }),
    { sessionId } = await command("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
  await command("Page.enable", {}, sessionId);
  await command("Runtime.enable", {}, sessionId);
  await command(
    "Emulation.setDeviceMetricsOverride",
    { ...viewport, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  const configureMotion = (session) =>
    command(
      "Emulation.setEmulatedMedia",
      {
        features: [{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }],
      },
      session,
    );
  await configureMotion(sessionId);
  const errors = [];
  socket.addEventListener("message", ({ data }) => {
    const response = JSON.parse(data);
    if (
      response.sessionId === sessionId &&
      response.method === "Runtime.exceptionThrown"
    )
      errors.push(
        response.params.exceptionDetails.exception?.description ||
          response.params.exceptionDetails.text,
      );
  });
  const origin = `http://127.0.0.1:${server.address().port}`,
    url = origin + prefix;
  await command("Page.navigate", { url }, sessionId);
  const evaluate = async (fn, argument) => {
    const result = await command(
      "Runtime.evaluate",
      {
        expression: `(${fn.toString()})(${JSON.stringify(argument)})`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    ).catch((error) => {
      throw new Error(`${error.message}\n${fn.toString()}`);
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  async function wait(fn, timeout = 30000, argument) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(fn, argument)) return;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error("Bedingung nicht erreicht: " + fn.toString());
  }
  await wait(
    () =>
      document.readyState === "complete" &&
      document.querySelector("#welcome .icon"),
  );
  return {
    evaluate,
    wait,
    errors,
    url,
    override: (path, data) => overrides.set(path, data),
    newTab: async () => {
      const { targetId } = await command("Target.createTarget", {
          url: "about:blank",
        }),
        { sessionId: tabSession } = await command("Target.attachToTarget", {
          targetId,
          flatten: true,
        });
      await command("Page.enable", {}, tabSession);
      await configureMotion(tabSession);
      await command("Page.navigate", { url }, tabSession);
      return async (fn, arg) => {
        const result = await command(
          "Runtime.evaluate",
          {
            expression: `(${fn.toString()})(${JSON.stringify(arg)})`,
            awaitPromise: true,
            returnByValue: true,
          },
          tabSession,
        );
        if (result.exceptionDetails)
          throw new Error(
            result.exceptionDetails.exception?.description ||
              result.exceptionDetails.text,
          );
        return result.result.value;
      };
    },
    command: (method, params) => command(method, params, sessionId),
    screenshot: async (path) => {
      const { data } = await command(
        "Page.captureScreenshot",
        { format: "png" },
        sessionId,
      );
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, Buffer.from(data, "base64"));
    },
    navigate: async () => command("Page.navigate", { url }, sessionId),
    offline: async (value) => {
      await command("Network.enable", {}, sessionId);
      await command(
        "Network.setCacheDisabled",
        { cacheDisabled: true },
        sessionId,
      );
      await command(
        "Network.emulateNetworkConditions",
        {
          offline: value,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        },
        sessionId,
      );
    },
  };
}
