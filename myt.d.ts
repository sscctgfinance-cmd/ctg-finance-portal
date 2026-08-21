// Declarations only — see myt.js. A constant or a formula copied here is a second copy of Malaysian
// time that nothing checks, which is the whole thing this module exists to prevent.
export declare function mytDate(t?: number | string | Date | null): Date | null;
export declare function mytISO(t?: number | string | Date | null): string;
export declare function mytISOPlusDays(days: number): string;
export declare function mytYMD(t?: number | string | Date | null): { year: number; month: number; day: number } | null;
export declare function mytDtLocal(t?: number | string | Date | null): string;
export declare function mytFromDtLocal(s: string): Date | null;
