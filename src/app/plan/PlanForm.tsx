"use client";

import { useActionState } from "react";
import { submitTripPreferences } from "./actions";
import { initialPlanFormState } from "./formPreferences";
import { PlanSummary } from "./PlanSummary";

const PACE_OPTIONS = [
  { value: "relaxed", label: "여유롭게" },
  { value: "balanced", label: "균형있게" },
  { value: "packed", label: "알차게" },
] as const;

const inputClassName =
  "w-full rounded-xl border border-black/10 bg-transparent px-4 py-3 text-base text-foreground outline-none focus:border-foreground/40 dark:border-white/15";

const labelClassName = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

export function PlanForm() {
  const [state, formAction, isPending] = useActionState(
    submitTripPreferences,
    initialPlanFormState,
  );

  if (state.status === "success") {
    return (
      <PlanSummary
        data={state.data}
        itinerary={state.itinerary}
        planningNotice={state.planningNotice}
        dataSource={state.dataSource}
      />
    );
  }

  const values = state.status === "error" ? state.values : undefined;

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelClassName}>시작일</span>
          <input
            type="date"
            name="startDate"
            required
            defaultValue={values?.startDate}
            className={inputClassName}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClassName}>종료일</span>
          <input
            type="date"
            name="endDate"
            required
            defaultValue={values?.endDate}
            className={inputClassName}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelClassName}>숙소 이름</span>
        <input
          type="text"
          name="lodgingName"
          required
          placeholder="예: 호텔 오사카"
          defaultValue={values?.lodgingName}
          className={inputClassName}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClassName}>숙소 지역</span>
        <input
          type="text"
          name="lodgingArea"
          required
          placeholder="예: 난바"
          defaultValue={values?.lodgingArea}
          className={inputClassName}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClassName}>인원 수</span>
        <input
          type="number"
          name="partySize"
          inputMode="numeric"
          min={1}
          required
          defaultValue={values?.partySize ?? 1}
          className={inputClassName}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClassName}>필수 방문지</span>
        <textarea
          name="mustVisit"
          rows={2}
          placeholder="쉼표 또는 줄바꿈으로 구분 (예: 오사카성, 도톤보리)"
          defaultValue={values?.mustVisit}
          className={inputClassName}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClassName}>관심사</span>
        <textarea
          name="interests"
          rows={2}
          placeholder="쉼표 또는 줄바꿈으로 구분 (예: 음식, 쇼핑)"
          defaultValue={values?.interests}
          className={inputClassName}
        />
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className={labelClassName}>여행 속도</legend>
        <div className="grid grid-cols-3 gap-2">
          {PACE_OPTIONS.map((option, index) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center justify-center rounded-xl border border-black/10 px-2 py-2.5 text-sm has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background dark:border-white/15"
            >
              <input
                type="radio"
                name="pace"
                value={option.value}
                defaultChecked={
                  values ? values.pace === option.value : index === 1
                }
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className={labelClassName}>제약 조건 (선택)</span>
        <textarea
          name="constraints"
          rows={2}
          placeholder="쉼표 또는 줄바꿈으로 구분 (예: 이른 아침 일정 제외)"
          defaultValue={values?.constraints}
          className={inputClassName}
        />
      </label>

      {state.status === "error" && (
        <ul className="flex flex-col gap-1 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {state.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 h-12 w-full rounded-full bg-foreground px-6 text-sm font-medium text-background disabled:opacity-50"
      >
        {isPending ? "확인 중..." : "일정 만들기"}
      </button>
    </form>
  );
}
