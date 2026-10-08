/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // avoid double-mounted audio/WebSocket in dev
  output: "export",       // static files in ./out, served locally by Electron
  images: { unoptimized: true },
};
export default nextConfig;
