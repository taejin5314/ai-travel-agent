import { describe, expect, it } from "vitest";
import { bestOrder, type OrderCost } from "@/agent/orderDay";
import type { Place } from "@/domain/schema/place";

const open = { open: "09:00", close: "20:00" };

function at(id: string, lng: number): Place {
  return {
    id,
    name: id,
    area: "osaka",
    category: "sight",
    // One dimension is enough: distance is |lng difference|.
    location: { lat: 34.67, lng },
    openingHours: [open, open, open, open, open, open, open],
    typicalVisitMinutes: 60,
  };
}

/** Sum of gaps along the order, so a zig-zag costs more than a sweep. */
const walkCost: OrderCost = async (order) =>
  order
    .slice(1)
    .reduce(
      (total, place, index) =>
        total + Math.abs(place.location.lng - order[index].location.lng),
      0,
    );

describe("bestOrder", () => {
  it("straightens a zig-zag into a sweep", async () => {
    // a → c → b costs 2 + 1 = 3; a → b → c costs 1 + 1 = 2.
    const zigzag = [at("a", 0), at("c", 2), at("b", 1)];
    const ordered = await bestOrder(zigzag, walkCost);
    expect(ordered.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves an already-optimal order alone", async () => {
    const straight = [at("a", 0), at("b", 1), at("c", 2)];
    const ordered = await bestOrder(straight, walkCost);
    expect(ordered.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("never returns an order the caller rejects", async () => {
    // Feasibility is the caller's to decide: an order that breaks opening
    // hours is not an improvement however short it looks.
    const places = [at("a", 0), at("c", 2), at("b", 1)];
    const rejectsTheShortcut: OrderCost = async (order) =>
      order.map((p) => p.id).join("") === "abc"
        ? undefined
        : walkCost(order);
    const ordered = await bestOrder(places, rejectsTheShortcut);
    expect(ordered.map((p) => p.id).join("")).not.toBe("abc");
  });

  it("keeps the original when every alternative is infeasible", async () => {
    const places = [at("a", 0), at("c", 2), at("b", 1)];
    const ordered = await bestOrder(places, async () => undefined);
    expect(ordered.map((p) => p.id)).toEqual(["a", "c", "b"]);
  });

  it("is deterministic when several orders tie", async () => {
    const places = [at("a", 0), at("b", 1), at("c", 2)];
    const allEqual: OrderCost = async () => 1;
    const first = await bestOrder(places, allEqual);
    const second = await bestOrder(places, allEqual);
    expect(first.map((p) => p.id)).toEqual(second.map((p) => p.id));
    // A tie leaves the incumbent in place rather than shuffling.
    expect(first.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("passes through a day too short to reorder", async () => {
    expect(await bestOrder([], walkCost)).toEqual([]);
    const single = [at("a", 0)];
    expect(await bestOrder(single, walkCost)).toEqual(single);
  });

  it("refuses to search a day large enough to be slow", async () => {
    // 7 stops is 5040 orders. The pace cap keeps real days far below this;
    // the guard stops a future change turning planning into a long search.
    const many = [0, 3, 1, 4, 2, 6, 5].map((lng) => at(`p${lng}`, lng));
    const ordered = await bestOrder(many, walkCost);
    expect(ordered.map((p) => p.id)).toEqual(many.map((p) => p.id));
  });
});
