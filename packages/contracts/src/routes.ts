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

  workers: {
    collection: `${base}/workers`,
    item: (id: string) => `${base}/workers/${id}`,
  },

  sessions: {
    collection: `${base}/field-operations`,
    item: (id: string) => `${base}/field-operations/${id}`,
    end: (id: string) => `${base}/field-operations/${id}/end`,
  },

  countdown: {
    start: `${base}/alerts/countdown`,
    cancel: (id: string) => `${base}/alerts/countdown/${id}/cancel`,
    activate: `${base}/alerts/activate`,
  },

  alerts: {
    collection: `${base}/alerts`,
    item: (id: string) => `${base}/alerts/${id}`,
    timeline: (id: string) => `${base}/alerts/${id}/timeline`,
    location: (id: string) => `${base}/alerts/${id}/location`,
    claim: (id: string) => `${base}/alerts/${id}/claim`,
    release: (id: string) => `${base}/alerts/${id}/release`,
    notes: (id: string) => `${base}/alerts/${id}/notes`,
    priority: (id: string) => `${base}/alerts/${id}/priority`,
    resolve: (id: string) => `${base}/alerts/${id}/resolve`,
  },

  workerView: {
    /** Token-authenticated, no account required. */
    view: (token: string) => `${base}/worker-view/${token}`,
    acknowledge: (token: string) => `${base}/worker-view/${token}/acknowledge`,
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
