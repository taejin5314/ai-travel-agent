import { z } from "zod";
import { TimeStringSchema } from "@/domain/schema/time";

/**
 * The destination this place belongs to. A registry id rather than an enum:
 * the set of destinations is data (fixtures/destinations.json), so widening
 * coverage must not require a schema change. Validity against the registry is
 * enforced at the provider boundary, where places are created.
 */
export const PlaceAreaSchema = z.string().min(1);

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

/**
 * What one person typically spends here, as the data source reports it.
 *
 * Both bounds are optional because real data is often half-open: Google gives
 * kaiseki restaurants a start price of ¥10,000 and no ceiling. A missing bound
 * is left missing rather than filled in — an invented upper bound would turn
 * "from ¥10,000" into a budget the traveller could hold us to.
 */
export const PriceRangeSchema = z
  .object({
    /** ISO 4217, e.g. "JPY". */
    currency: z.string().length(3),
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  })
  .refine((range) => range.min !== undefined || range.max !== undefined, {
    message: "A price range with neither bound carries no information",
  })
  .refine((range) => range.min === undefined || range.max === undefined || range.min <= range.max, {
    message: "min must not exceed max",
  });

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
  /** Typical spend per person. Absent when the source has no price data. */
  priceRange: PriceRangeSchema.optional(),
});

export type PriceRange = z.infer<typeof PriceRangeSchema>;
export type Place = z.infer<typeof PlaceSchema>;
