const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "public",
  naming: "[dir]/_worker.js",
  splitting: false,
  minify: Bun.env.NODE_ENV === "production",
});

if (!result.success) {
  throw new Error("Build failed");
}
