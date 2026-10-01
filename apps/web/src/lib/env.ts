/** API URL as seen from the browser. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** API URL as seen from the Next.js server (http://api:4000 inside Docker). */
export const SERVER_API_URL = process.env.API_URL ?? API_URL;
