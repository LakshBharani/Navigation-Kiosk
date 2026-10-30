const pages: Record<string, string> = {};

export function createUrl(slug: string, content: string): string {
  pages[slug] = content;
  return `http://localhost:3000/p/${slug}`;
}

export function getContent(slug: string): string | undefined {
  return pages[slug];
}