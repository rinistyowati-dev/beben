/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.benable.com" },
      { protocol: "https", hostname: "assets.benable.com" },
      { protocol: "https", hostname: "image-proxy.benable.com" },
    ],
  },
};
export default nextConfig;
