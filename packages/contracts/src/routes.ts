import { API_VERSION } from './common';

/**
 * Route paths in one place so the API, the web client and the generated OpenAPI
 * document cannot drift. The mobile clients read these from the generated OpenAPI
 * file rather than hardcoding strings.
 */
const base = `/api/${API_VERSION}` as const;

export const Routes = {
  base,

  auth: {
    register: `${base}/auth/register`,
    login: `${base}/auth/login`,
    refresh: `${base}/auth/refresh`,
    logout: `${base}/auth/logout`,
    me: `${base}/auth/me`,
  },

  contacts: {
    collection: `${base}/trusted-contacts`,
    item: (id: string) => `${base}/trusted-contacts/${id}`,
  },

  sessions: {
    collection: `${base}/safety-sessions`,
    item: (id: string) => `${base}/safety-sessions/${id}`,
    end: (id: string) => `${base}/safety-sessions/${id}/end`,
  },

  countdown: {
    start: `${base}/sos/countdown`,
    cancel: (id: string) => `${base}/sos/countdown/${id}/cancel`,
    activate: `${base}/sos/activate`,
  },

  incidents: {
    collection: `${base}/incidents`,
    item: (id: string) => `${base}/incidents/${id}`,
    timeline: (id: string) => `${base}/incidents/${id}/timeline`,
    location: (id: string) => `${base}/incidents/${id}/location`,
    claim: (id: string) => `${base}/incidents/${id}/claim`,
    release: (id: string) => `${base}/incidents/${id}/release`,
    notes: (id: string) => `${base}/incidents/${id}/notes`,
    priority: (id: string) => `${base}/incidents/${id}/priority`,
    resolve: (id: string) => `${base}/incidents/${id}/resolve`,
  },

  contactView: {
    /** Token-authenticated, no account required. */
    view: (token: string) => `${base}/contact-view/${token}`,
    acknowledge: (token: string) => `${base}/contact-view/${token}/acknowledge`,
  },

  privacy: {
    settings: `${base}/privacy/settings`,
    export: `${base}/privacy/export`,
    exportStatus: (id: string) => `${base}/privacy/export/${id}`,
    deletion: `${base}/privacy/deletion`,
  },

  subscriptions: {
    current: `${base}/subscriptions/current`,
    verify: `${base}/subscriptions/verify`,
    entitlement: `${base}/subscriptions/entitlement`,
  },

  admin: {
    auditLog: `${base}/admin/audit-log`,
    users: `${base}/admin/users`,
  },

  ops: {
    health: '/health',
    ready: '/ready',
    openapi: '/openapi.json',
    graphql: '/graphql',
  },
} as const;
