import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/day-map/route";

function ask(points: string): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/day-map?points=${encodeURIComponent(points)}`),
  );
}

describe("day-map proxy", () => {
  it("refuses coordinates outside every registered destination", async () => {
    // Without this the route is a general-purpose image proxy billed to us.
    const tokyoTower = await ask("35.6586,139.7454");
    expect(tokyoTower.status).toBe(400);
  });

  it("refuses more points than a day can hold", async () => {
    const tooMany = Array.from({ length: 13 }, () => "34.6873,135.5262").join("|");
    expect((await ask(tooMany)).status).toBe(400);
  });

  it("refuses anything that is not a coordinate", async () => {
    expect((await ask("not,a,point")).status).toBe(400);
    expect((await ask("")).status).toBe(400);
  });

  it("never puts the server key in the response", async () => {
    // The whole reason this proxy exists: the key carries Places and Routes
    // quota, so it must not reach the browser in a body or a redirect.
    process.env.GOOGLE_MAPS_API_KEY = "server-only-secret";
    const response = await ask("34.6873,135.5262|34.6687,135.5013");
    const body = await response.text().catch(() => "");
    expect(body).not.toContain("server-only-secret");
    expect(response.headers.get("location") ?? "").not.toContain(
      "server-only-secret",
    );
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it("reports a bad gateway without explaining why, when there is no key", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const response = await ask("34.6873,135.5262|34.6687,135.5013");
    expect(response.status).toBe(502);
  });
});
