/**
 * The merchant console is a separate deployable (docs/product/surfaces.md lists it
 * as its own surface), so "Merchant sign in" cannot be a router link from here —
 * it leaves this app. Different port in dev, different domain in production;
 * one place to change it.
 */
export const MERCHANT_WEB_URL = import.meta.env.VITE_MERCHANT_WEB_URL ?? 'http://localhost:5173';
