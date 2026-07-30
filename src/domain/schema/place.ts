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
  "restaurant",
  "lodging",
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
  /** Alternative names (e.g. Korean) accepted when matching user input. */
  aliases: z.array(z.string().min(1)).optional(),
  area: PlaceAreaSchema,
  category: PlaceCategorySchema,
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  openingHours: OpeningHoursSchema,
  typicalVisitMinutes: z.number().int().positive(),
  /** Average review score, 0-5. Optional until every data source provides it. */
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
});

export type Place = z.infer<typeof PlaceSchema>;
