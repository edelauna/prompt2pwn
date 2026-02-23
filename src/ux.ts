import pc from "picocolors";
import { Spinner } from "@std/cli/unstable-spinner";

export const ux = {
  info: (msg: string) => console.log(pc.cyan(msg)),
  success: (msg: string) => console.log(pc.green(msg)),
  warn: (msg: string) => console.log(pc.yellow(msg)),
  error: (msg: string, detail?: unknown) => {
    console.error(pc.red(msg));
    if (detail) console.error(detail);
  },
  bold: (msg: string) => pc.bold(msg),
  gray: (msg: string) => pc.gray(msg),
  magenta: (msg: string) => pc.magenta(msg),

  async withSpinner<T>(
    message: string,
    fn: (spinner: Spinner) => Promise<T>,
  ): Promise<T> {
    const spinner = new Spinner({
      message: pc.cyan(message),
      color: "cyan",
    });
    spinner.start();
    try {
      const result = await fn(spinner);
      spinner.stop();
      // Ensure we clear the line or move to next line nicely
      return result;
    } catch (e) {
      spinner.stop();
      throw e;
    }
  },
};
