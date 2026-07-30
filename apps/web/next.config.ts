import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The package resolves to its built dist/ (see its "main"), so
  // `npm run build:contracts` must run before web too. transpilePackages keeps
  // it watched in dev: a contracts rebuild is picked up without a restart.
  transpilePackages: ['@mon-sinistre/contracts'],
  typedRoutes: true,
};

export default nextConfig;
