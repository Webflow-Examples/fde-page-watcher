import { PagesPageContent } from "./pages-content";

interface PagesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function PagesPage({ searchParams }: PagesPageProps) {
  const params = await searchParams;

  return <PagesPageContent initialFilter={first(params.filter)} initialView={first(params.view)} />;
}
