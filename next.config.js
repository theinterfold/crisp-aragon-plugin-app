/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  transpilePackages: ["@aragon/ods"],
  webpack: (config, { isServer }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // `@interfold/sdk` guards a Node-only circuit sanity check behind `await import("fs")`.
    // Webpack still resolves that import statically when bundling for the browser, where the
    // branch never runs — stub the Node builtins so the client build does not fail on it.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        url: false,
      };
    }

    return config;
  },
};

module.exports = nextConfig;
