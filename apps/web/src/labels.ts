import type { Difficulty } from "./api/client";

export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  streetLegend: "街头传说",
  nightCity: "夜之城",
  deathCity: "死亡之城",
};

export const DIFFICULTY_NOTES: Readonly<Record<Difficulty, string>> = {
  streetLegend: "难度值 −2，适合先熟悉玩法",
  nightCity: "原作的标准难度",
  deathCity: "难度值 +2，失败的代价更重",
};

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
