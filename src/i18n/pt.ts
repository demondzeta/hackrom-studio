import { ROWS } from "./table";

export const PT: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[2]]));
