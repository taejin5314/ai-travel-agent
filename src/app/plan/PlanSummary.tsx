import type { TripPreferences } from "@/domain/schema/tripPreferences";

const PACE_LABELS: Record<TripPreferences["pace"], string> = {
  relaxed: "여유롭게",
  balanced: "균형있게",
  packed: "알차게",
};

export function PlanSummary({ data }: { data: TripPreferences }) {
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

      <p className="rounded-xl bg-black/5 px-4 py-3 text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-400">
        일정 생성은 준비 중입니다.
      </p>
    </div>
  );
}
