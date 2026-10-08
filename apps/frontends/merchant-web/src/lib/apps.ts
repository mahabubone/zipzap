/**
 * Public tracking is a separate deployable (docs/product/surfaces.md lists it as
 * its own surface), so the landing page's primary CTA cannot be a router link —
 * it leaves this app. Different port in dev, different domain in production;
 * one place to change it.
 */
export const TRACKING_URL = import.meta.env.VITE_TRACKING_URL ?? 'http://localhost:5174';
