import { PlanForm } from "./PlanForm";

export default function PlanPage() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <h1 className="text-balance text-center text-2xl font-semibold leading-tight tracking-tight">
          여행 선호도를 알려주세요
        </h1>

        <p className="text-pretty text-center text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          날짜, 숙소, 인원과 관심사를 입력하면 선호도를 확인해 드립니다.
        </p>

        <PlanForm />
      </div>
    </main>
  );
}
