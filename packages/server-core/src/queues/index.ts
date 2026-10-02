/** BullMQ queue names, shared by producers (api) and consumers (workers). */
export const QUEUES = {
  EMAIL: "email",
} as const;

export * from "./email.queue";
