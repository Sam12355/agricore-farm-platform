/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The web tier imports Zod schemas and design tokens directly from the workspace
  // packages rather than through a published build, so Next has to transpile them.
  transpilePackages: [
    '@guardianlink/contracts',
    '@guardianlink/shared-types',
    '@guardianlink/design-tokens',
  ],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // A contact-view URL is a credential. Sending it in a Referer header to any
          // third-party resource on the page would leak it, so no referrer is sent at all.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            // Geolocation is denied for the web tier deliberately. Location comes from
            // the mobile clients; the console and portal never need the browser's.
            value: 'geolocation=(), camera=(), microphone=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
