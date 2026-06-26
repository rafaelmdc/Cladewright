// FAQ content, curated in the Django admin and served read-only. See apps/content.

export interface FaqEntry {
  id: number;
  question: string;
  answer: string;
}

/** Fetch the published FAQ entries (ordered). Returns [] if the backend is down. */
export async function fetchFaq(): Promise<FaqEntry[]> {
  try {
    const res = await fetch("/api/content/faq/");
    if (!res.ok) return [];
    const data = await res.json();
    return (data.entries ?? []) as FaqEntry[];
  } catch {
    return [];
  }
}
