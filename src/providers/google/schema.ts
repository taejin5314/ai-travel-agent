import { z } from "zod";

/**
 * Zod schemas for Google Places API (New) and Routes API responses.
 * Everything crossing this boundary is untrusted (AGENTS.md §7): responses
 * are parsed here before any mapping to domain types, and the mapped result
 * is parsed AGAIN with PlaceSchema in the provider.
 */

const GoogleTimePointSchema = z.object({
  /** 0 = Sunday .. 6 = Saturday (Google convention). */
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});

export const GooglePlaceSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string().min(1) }),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  formattedAddress: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  userRatingCount: z.number().int().nonnegative().optional(),
  types: z.array(z.string()).optional(),
  regularOpeningHours: z
    .object({
      periods: z
        .array(
          z.object({
            open: GoogleTimePointSchema,
            // Missing close = open 24 hours.
            close: GoogleTimePointSchema.optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export type GooglePlace = z.infer<typeof GooglePlaceSchema>;

export const SearchTextResponseSchema = z.object({
  places: z.array(GooglePlaceSchema).optional(),
});

export const ComputeRoutesResponseSchema = z.object({
  routes: z
    .array(
      z.object({
        /** e.g. "1234s" */
        duration: z.string().regex(/^\d+(\.\d+)?s$/),
        /**
         * Per-step modes. A TRANSIT query can come back as an all-WALK route
         * when no transit is available (or served) for the pair, and the
         * duration alone gives no way to tell.
         */
        legs: z
          .array(
            z.object({
              steps: z
                .array(z.object({ travelMode: z.string().optional() }))
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});
