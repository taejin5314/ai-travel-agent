import { describe, expect, it } from "vitest";
import { googleMapsApiKey, googleMapsBrowserKey } from "@/lib/config";

describe("googleMapsBrowserKey", () => {
  it("is undefined when unset, which is a supported state", () => {
    // The picker falls back to a list, so dev and CI need no browser key.
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
    expect(googleMapsBrowserKey()).toBeUndefined();
  });

  it("never falls back to the server key", () => {
    // The server key carries Places and Routes quota. Shipping it to the
    // browser would let anyone spend it, so the two must not be conflated.
    process.env.GOOGLE_MAPS_API_KEY = "server-only-secret";
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;

    expect(googleMapsApiKey()).toBe("server-only-secret");
    expect(googleMapsBrowserKey()).toBeUndefined();

    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it("trims and reads the public variable", () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY = "  browser-key  ";
    expect(googleMapsBrowserKey()).toBe("browser-key");
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  });
});
