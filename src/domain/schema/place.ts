import { z } from "zod";
import { TimeStringSchema } from "@/domain/schema/time";

export const PlaceAreaSchema = z.enum(["osaka", "kyoto"]);

export const PlaceCategorySchema = z.enum([
  "sight",
  "food",
  "shopping",
  "nature",
  "culture",
  "entertainment",
]);

const OpeningHoursEntrySchema = z
  .object({
    open: TimeStringSchema,
    close: TimeStringSchema,
  })
  .nullable();

// Mon..Sun, index 0-6
const OpeningHoursSchema = z.tuple([
  OpeningHoursEntrySchema,
  OpeningHoursEntrySchema,
  OpeningHoursEntrySchema,
  OpeningHoursEntrySchema,
  OpeningHoursEntrySchema,
  OpeningHoursEntrySchema,
  OpeningHoursEntrySchema,
]);

export const PlaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  area: PlaceAreaSchema,
  category: PlaceCategorySchema,
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  openingHours: OpeningHoursSchema,
  typicalVisitMinutes: z.number().int().positive(),
});

export type Place = z.infer<typeof PlaceSchema>;
