const queue = [];
let active = null;
function next() {
  if (active || !queue.length) return;
  const job = queue.shift();
  if (job.signal?.aborted) {
    job.reject(new DOMException("Abgebrochen", "AbortError"));
    next();
    return;
  }
  active = job;
  let timer;
  let finished = false;
  const finish = (error, result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    job.signal?.removeEventListener("abort", abort);
    if (job.worker) {
      job.worker.onmessage = null;
      job.worker.onerror = null;
      job.worker.terminate();
    }
    active = null;
    error ? job.reject(error) : job.resolve(result);
    next();
  };
  const abort = () => finish(new DOMException("Abgebrochen", "AbortError"));
  try {
    job.worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    job.worker.onmessage = ({ data }) => {
      if (data.type === "progress") job.progress?.(data.value);
      else if (data.type === "result") finish(null, data.result);
      else finish(new Error(data.message));
    };
    job.worker.onerror = (event) => {
      event.preventDefault();
      finish(
        new Error(
          "Die lokale PDF-Verarbeitung konnte nicht ausgeführt werden.",
        ),
      );
    };
    job.signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(
      () =>
        finish(
          new Error(
            "Die Verarbeitung dauert zu lange. Bitte eine kleinere Auswahl versuchen.",
          ),
        ),
      180000,
    );
    const buffers = new Set();
    const collect = (value) => {
      if (value instanceof ArrayBuffer) buffers.add(value);
      else if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object")
        Object.values(value).forEach(collect);
    };
    collect(job.payload);
    job.worker.postMessage(
      { id: job.id, task: job.task, payload: job.payload },
      [...buffers],
    );
  } catch (error) {
    finish(error);
  }
}
export function processPdf(task, payload, { signal, progress } = {}) {
  return new Promise((resolve, reject) => {
    queue.push({
      id: crypto.randomUUID(),
      task,
      payload,
      signal,
      progress,
      resolve,
      reject,
    });
    next();
  });
}
