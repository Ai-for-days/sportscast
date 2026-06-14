export function cleanWagerTitle(title: string): string {
  return title.replace(/\bSpreLad\b/g, 'Spread');
}
