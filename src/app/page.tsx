import Link from "next/link";
import { serviceableDestinations } from "@/domain/coverage";

/**
 * The cities we can actually plan, read from the measured coverage rather than
 * typed in. The badge said "오사카 · 교토" for as long as it took to ship two
 * more, which is what happens to any list a human has to remember to edit.
 */
function serviceableNames(): string[] {
  return serviceableDestinations().map((destination) => destination.name);
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <span className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium tracking-wide text-zinc-600 dark:border-white/15 dark:text-zinc-400">
          {serviceableNames().join(" · ")}
        </span>

        <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          AI 여행 플래너
        </h1>

        <p className="text-pretty text-base leading-7 text-zinc-600 dark:text-zinc-400">
          여행 지역과 날짜만 정하면 평점 높은 숙소와 맛집, 관광지를 지도에
          띄워 드립니다. 가고 싶은 곳을 고르면 이동시간과 운영시간을 검증한
          날짜별 동선으로 짜 드립니다.
        </p>

        <Link
          href="/plan"
          className="mt-2 flex h-12 w-full max-w-xs items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background"
        >
          여행 계획 시작
        </Link>
      </div>
    </main>
  );
}
