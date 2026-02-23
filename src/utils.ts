export async function computeFileHash(filePath: string): Promise<string> {
  const content = await Deno.readFile(filePath);
  const hash = await crypto.subtle.digest("SHA-256", content);
  return Array.from(new Uint8Array(hash)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}
