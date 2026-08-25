import { PagesPageContent } from "./pages-content";

interface PagesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PagesPage({ searchParams }: PagesPageProps) {
  const params = await searchParams;
  const filter = Array.isArray(params.filter) ? params.filter[0] : params.filter;

  return <PagesPageContent initialFilter={filter} />;
}
