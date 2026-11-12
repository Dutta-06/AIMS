import type { NextConfig } from "next";

// The site is exported as plain static files so it can be hosted on GitHub Pages. It holds no data
// and no secrets: everything lives in the backend, which checks the password.
// On Pages the site lives under /<repo name>/, so the build is told that via NEXT_PUBLIC_BASE_PATH.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath,
};

export default nextConfig;
