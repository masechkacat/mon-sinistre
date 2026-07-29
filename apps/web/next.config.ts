import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The contracts package ships TypeScript sources, so Next has to compile it
  // alongside the app rather than treat it as a prebuilt dependency.
  transpilePackages: ['@jalons/contracts'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
