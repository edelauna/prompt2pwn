import { assertEquals } from "std/assert";
import { ux } from "../ux.ts";

Deno.test("ux color functions", () => {
  // Test that color functions return strings (since they wrap picocolors)
  assertEquals(typeof ux.bold("test"), "string");
  assertEquals(typeof ux.gray("test"), "string");
  assertEquals(typeof ux.magenta("test"), "string");
  // Test error with detail to cover branch
  ux.error("test error", "detail");
});
