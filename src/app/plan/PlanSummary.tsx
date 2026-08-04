import type { TripPreferences } from "@/domain/schema/tripPreferences";
import { DayMap } from "./DayMap";
import { formatCost, hasFigure, totalCost } from "./cost";
import {
  constraintLabel,
  cuisineLabel,
  type ItineraryViewDay,
} from "./formPreferences";

const PACE_LABELS: Record<TripPreferences["pace"], string> = {
  relaxed: "여유롭게",
  balanced: "균형있게",
  packed: "알차게",
};

const DAY_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "short",
  timeZone: "UTC",
});

/**
 * The trip total, and — just as important — what it leaves out. Google has no
 * admission price for attractions and returns no transit for Japan at all, so
 * calling a meals-only figure "trip cost" would be the same class of lie as
 * labelling a walk as a train ride.
 */
function CostSummary({ days }: { days: ItineraryViewDay[] }) {
  const total = totalCost(days);
  if (total === undefined || !hasFigure(total)) {
    return null;
  }
  return (
    <div className="rounded-xl bg-black/5 px-4 py-3 text-sm dark:bg-white/10">
      <p className="flex justify-between gap-3">
        <span className="font-medium">예상 식사 비용</span>
        <span className="tabular-nums">{formatCost(total)}</span>
      </p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        일정에 포함된 식당 {total.pricedStops}곳의 1인 가격대를 인원수만큼
        더한 값입니다.
        {total.unpricedStops > 0 &&
          ` 가격 정보가 없는 ${total.unpricedStops}곳은 빠져 있습니다.`}{" "}
        관광지 입장료와 교통비는 포함되지 않았습니다 — 제공되는 데이터가
        없습니다.
      </p>
    </div>
  );
}

function ItineraryList({ days }: { days: ItineraryViewDay[] }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">생성된 일정</h2>
      <CostSummary days={days} />
      <ol className="flex flex-col gap-3">
        {days.map((day, index) => (
          <li
            key={day.date}
            className="rounded-xl border border-black/10 p-4 dark:border-white/15"
          >
            <p className="mb-2 flex justify-between gap-3 text-sm font-medium">
              <span>
                {index + 1}일차 ·{" "}
                {DAY_FORMATTER.format(new Date(`${day.date}T00:00:00Z`))}
              </span>
              {day.cost !== undefined && hasFigure(day.cost) && (
                <span className="font-normal tabular-nums text-zinc-600 dark:text-zinc-400">
                  식사 {formatCost(day.cost)}
                </span>
              )}
            </p>
            {day.items.length === 0 ? (
              <p className="text-sm text-zinc-500">자유 시간</p>
            ) : (
              <>
              <DayMap items={day.items} />
              <ul className="flex flex-col gap-1 text-sm">
                {day.items.map((item, itemIndex) => (
                  <li key={`${day.date}-${item.start}`}>
                    {/* The leg that reaches this stop, so the gap before it is
                        explained rather than looking like dead time. The first
                        stop of a day has nothing above it to travel from. */}
                    {itemIndex > 0 && item.travel !== undefined && (
                      <p className="py-0.5 text-xs text-zinc-500">
                        {item.travel.mode === "walk" ? "🚶" : "🚃"}{" "}
                        {/* An estimate is marked as one. It comes from a
                            straight-line model, not a routing service, and
                            must not read like a departure board. */}
                        {item.travel.estimated ? "약 " : ""}
                        {item.travel.minutes}분 이동
                        {item.travel.lines !== undefined && (
                          <span className="ml-1 text-zinc-600 dark:text-zinc-400">
                            ·{" "}
                            {item.travel.lines
                              .map((ride) =>
                                ride.from !== undefined && ride.to !== undefined
                                  ? `${ride.line} (${ride.from}→${ride.to})`
                                  : ride.line,
                              )
                              .join(" → ")}
                          </span>
                        )}
                        {item.travel.estimated && (
                          <span className="ml-1 text-zinc-400">(추정)</span>
                        )}
                        {item.directionsUrl !== undefined && (
                          // Google Maps has Japanese rail with live times and
                          // platform numbers; its routing API does not. Hand
                          // the leg over rather than approximate it here.
                          <a
                            href={item.directionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-1.5 underline underline-offset-2"
                          >
                            길찾기
                          </a>
                        )}
                      </p>
                    )}
                    <div className="flex justify-between gap-4">
                      <span>
                        {/* Same number as the marker on the map above. */}
                        <span className="mr-1.5 text-xs tabular-nums text-zinc-500">
                          {itemIndex + 1}
                        </span>
                        {item.kind === "meal" ? "🍽️ " : ""}
                        <a
                          href={item.placeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-dotted underline-offset-2"
                        >
                          {item.placeName}
                        </a>
                        {item.rating !== undefined && (
                          <span className="ml-1 text-xs text-zinc-500">
                            ★ {item.rating.toFixed(1)}
                          </span>
                        )}
                        {item.priceRange !== undefined && (
                          <span className="ml-1 text-xs text-zinc-500">
                            {formatCost({ ...item.priceRange, pricedStops: 1, unpricedStops: 0 })}
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                        {item.start}–{item.end}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PlanSummary({
  data,
  itinerary,
  planningNotice,
  dataSource,
  planId,
}: {
  data: TripPreferences;
  itinerary?: ItineraryViewDay[];
  planningNotice?: string;
  dataSource?: "google" | "mock";
  planId?: string;
}) {
  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl border border-black/10 p-5 text-left dark:border-white/15">
      <h2 className="text-lg font-semibold">입력하신 여행 선호도</h2>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">기간</dt>
          <dd>
            {data.startDate} ~ {data.endDate}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">숙소</dt>
          <dd>
            {data.lodging.name} ({data.lodging.area})
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">인원</dt>
          <dd>{data.partySize}명</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">필수 방문지</dt>
          <dd className="text-right">{data.mustVisit.join(", ")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">관심사</dt>
          <dd className="text-right">{data.interests.join(", ") || "-"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">여행 속도</dt>
          <dd>{PACE_LABELS[data.pace]}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">먹고 싶은 음식</dt>
          <dd className="text-right">
            {data.cuisines && data.cuisines.length > 0
              ? data.cuisines.map(cuisineLabel).join(", ")
              : "-"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">제약 조건</dt>
          <dd className="text-right">
            {data.constraints && data.constraints.length > 0
              ? data.constraints.map(constraintLabel).join(", ")
              : "-"}
          </dd>
        </div>
      </dl>

      {itinerary !== undefined ? (
        <ItineraryList days={itinerary} />
      ) : (
        <p className="rounded-xl bg-black/5 px-4 py-3 text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-400">
          {planningNotice ?? "일정 생성은 준비 중입니다."}
        </p>
      )}

      {planId !== undefined && (
        <a
          href={`/plan/${planId}`}
          className="rounded-xl bg-black/5 px-4 py-3 text-center text-xs text-zinc-700 underline underline-offset-4 dark:bg-white/10 dark:text-zinc-300"
        >
          이 일정의 링크 열기 · 공유하기
        </a>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        {dataSource === "google"
          ? "일정은 Google 실시간 장소 데이터(평점·운영시간·이동시간)를 검증해 생성됩니다."
          : "일정은 장소 데이터(현재는 목 데이터)의 운영시간과 이동시간을 검증해 생성됩니다."}
      </p>
    </div>
  );
}
