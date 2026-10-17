import { describeError } from "../core/errors.js";
import { assemble, inspect, imagePdf } from "./engine.js";
import { tiffPdf } from "./tiff.js";
self.onmessage = async ({ data }) => {
  try {
    const result =
      data.task === "tiff-pdf"
        ? await tiffPdf(data.payload.data, (value) => self.postMessage({ id: data.id, type: "progress", value }))
        : data.task === "image-pdf"
        ? await imagePdf(data.payload.data, data.payload.mime)
        : data.task === "inspect"
          ? await inspect(data.payload.data, data.payload.password)
          : await assemble(data.payload, (value) =>
              self.postMessage({ id: data.id, type: "progress", value }),
            );
    self.postMessage(
      { id: data.id, type: "result", result },
      result.data ? [result.data.buffer] : [],
    );
  } catch (error) {
    self.postMessage({
      id: data.id,
      type: "error",
      message: describeError(error),
    });
  }
};
