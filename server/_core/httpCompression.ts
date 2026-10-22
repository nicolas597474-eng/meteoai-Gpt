import compression from "compression";

/** Weather diagnostics stay lossless; OAuth/auth/scheduled responses are not compressed. */
export const weatherHttpCompression = compression({
 threshold: 1024,
 level: 5,
 filter: (req, res) => {
  if (req.path.startsWith("/api/")) {
   const procedures = req.path.startsWith("/api/trpc/") ? req.path.slice("/api/trpc/".length).split(",") : [];
   if (!procedures.length || procedures.some(name => !name.startsWith("weather."))) return false;
  }
  return compression.filter(req, res);
 },
});
