/** Spara text som fil (CSV-exporten). Reserv: kopiera till urklipp. */

export function downloadText(text: string, filename: string, mime = 'text/csv'): boolean {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

/** Försöker spara som fil, annars urklipp. Returnerar hur det gick, för en kort bekräftelse. */
export async function exportCsv(csv: string, filename: string): Promise<'file' | 'clipboard' | 'failed'> {
  if (downloadText(csv, filename)) return 'file';
  try {
    await navigator.clipboard.writeText(csv);
    return 'clipboard';
  } catch {
    return 'failed';
  }
}

/** "metro-observationer-2026-11-13.csv" (lokalt datum). */
export function csvFilename(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `metro-observationer-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.csv`;
}
