import { ROWS } from "./table";

export const ES: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[1]]));
