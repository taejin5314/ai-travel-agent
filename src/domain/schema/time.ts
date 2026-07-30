import { z } from "zod";

export const TimeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time string in HH:MM (24h) format");

export type TimeString = z.infer<typeof TimeStringSchema>;
