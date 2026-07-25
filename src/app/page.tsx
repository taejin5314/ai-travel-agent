export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <span className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium tracking-wide text-zinc-600 dark:border-white/15 dark:text-zinc-400">
          오사카 · 교토
        </span>

        <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          AI 여행 플래너
        </h1>

        <p className="text-pretty text-base leading-7 text-zinc-600 dark:text-zinc-400">
          날짜, 숙소, 인원과 관심사만 입력하면 실제 장소 데이터와 이동시간,
          운영시간을 검증한 날짜별 일정을 만들어 드립니다.
        </p>

        <button
          type="button"
          disabled
          aria-disabled="true"
          className="mt-2 h-12 w-full max-w-xs cursor-not-allowed rounded-full bg-foreground px-6 text-sm font-medium text-background opacity-50"
        >
          여행 계획 시작
        </button>

        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          곧 만나요 · 현재 준비 중입니다
        </p>
      </div>
    </main>
  );
}
