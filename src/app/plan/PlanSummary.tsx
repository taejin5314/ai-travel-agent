import type { TripPreferences } from "@/domain/schema/tripPreferences";
import type { ItineraryViewDay } from "./formPreferences";

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

function ItineraryList({ days }: { days: ItineraryViewDay[] }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">생성된 일정</h2>
      <ol className="flex flex-col gap-3">
        {days.map((day, index) => (
          <li
            key={day.date}
            className="rounded-xl border border-black/10 p-4 dark:border-white/15"
          >
            <p className="mb-2 text-sm font-medium">
              {index + 1}일차 ·{" "}
              {DAY_FORMATTER.format(new Date(`${day.date}T00:00:00Z`))}
            </p>
            {day.items.length === 0 ? (
              <p className="text-sm text-zinc-500">자유 시간</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {day.items.map((item) => (
                  <li
                    key={`${day.date}-${item.start}`}
                    className="flex justify-between gap-4"
                  >
                    <span>{item.placeName}</span>
                    <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                      {item.start}–{item.end}
                    </span>
                  </li>
                ))}
              </ul>
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
}: {
  data: TripPreferences;
  itinerary?: ItineraryViewDay[];
  planningNotice?: string;
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
          <dt className="text-zinc-600 dark:text-zinc-400">제약 조건</dt>
          <dd className="text-right">
            {data.constraints && data.constraints.length > 0
              ? data.constraints.join(", ")
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

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        일정은 장소 데이터(현재는 목 데이터)의 운영시간과 이동시간을 검증해
        생성됩니다.
      </p>
    </div>
  );
}
