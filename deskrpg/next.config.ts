import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  serverExternalPackages: ["ssh2"],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  allowedDevOrigins: [
    '192.168.56.104', // 가상 머신의 IP (VirtualBox)
    'localhost',      // Mac 로컬에서 직접 띄울 때
    '127.0.0.1'       // 로컬 IP 접속용
  ],
};

export default nextConfig;
