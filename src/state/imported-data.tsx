// React Context + provider for parsed CSV uploads. Client-side only (in
// memory). On unmount or `clear()` the upload is dropped.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { AtlasAsset, importCsv } from "@/lib/csv-import";
import type { LocationDoc } from "@/components/atlas/types";

type ImportedState = {
  rows: AtlasAsset[];
  filename: string | null;
  importedAt: number | null;
  totalParsed: number;
  rejected: number;
};

const EMPTY: ImportedState = {
  rows: [],
  filename: null,
  importedAt: null,
  totalParsed: 0,
  rejected: 0,
};

type ImportedContextValue = {
  state: ImportedState;
  importing: boolean;
  importFromFile: (file: File) => Promise<void>;
  clear: () => void;
};

const ImportedContext = createContext<ImportedContextValue | null>(null);

export function ImportedDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImportedState>(EMPTY);
  const [importing, setImporting] = useState(false);

  const importFromFile = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const summary = importCsv(text, file.name);
      if (!summary.rows.length) {
        toast.error(
          `No valid rows in ${file.name}. Each row needs a Name, Latitude, and Longitude.`,
        );
        return;
      }
      setState({
        rows: summary.rows.map((r) => r.doc),
        filename: summary.filename,
        importedAt: Date.now(),
        totalParsed: summary.totalParsed,
        rejected: summary.rejected,
      });
      const total = summary.rows.length;
      toast.success(
        `Imported ${total} ${total === 1 ? "row" : "rows"} from ${file.name}` +
          (summary.rejected
            ? ` · ${summary.rejected} skipped (missing name or lat/lng)`
            : ""),
      );
    } catch (err) {
      console.error("CSV import error", err);
      toast.error(`Couldn't parse ${file.name}. Make sure it's a CSV or TSV file.`);
    } finally {
      setImporting(false);
    }
  }, []);

  const clear = useCallback(() => {
    setState((prev) => {
      if (!prev.filename) return prev;
      toast(`Cleared ${prev.rows.length} imported rows.`);
      return EMPTY;
    });
  }, []);

  const value = useMemo<ImportedContextValue>(
    () => ({ state, importing, importFromFile, clear }),
    [state, importing, importFromFile, clear],
  );

  return (
    <ImportedContext.Provider value={value}>{children}</ImportedContext.Provider>
  );
}

export function useImportedData() {
  const v = useContext(ImportedContext);
  if (!v)
    throw new Error("useImportedData must be used within <ImportedDataProvider>");
  return v;
}

/** Union seeded + imported with the imported overriding seeded by slug
 *  (case-insensitive). Seeded order is preserved; brand-new imports append. */
export function mergeAssets(
  seeded: LocationDoc[],
  imported: AtlasAsset[],
): (LocationDoc | AtlasAsset)[] {
  if (!imported.length) return seeded;

  const importedByLower = new Map<string, AtlasAsset>();
  for (const i of imported) importedByLower.set(i.slug.toLowerCase(), i);

  const out: (LocationDoc | AtlasAsset)[] = [];
  const consumed = new Set<string>();
  for (const s of seeded) {
    const k = s.slug.toLowerCase();
    const override = importedByLower.get(k);
    if (override) {
      out.push({ ...s, ...override });
      consumed.add(k);
    } else {
      out.push(s);
    }
  }
  for (const i of imported) {
    if (!consumed.has(i.slug.toLowerCase())) out.push(i);
  }
  return out;
}
