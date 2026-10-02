const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Make a string safe to put between HTML tags.
 *
 * The boards are built by interpolating into `innerHTML`, and a sailor's name is whatever
 * the server said it was. The server this page is talking to is chosen by a query
 * parameter, so it is not necessarily one of ours, and a name of `<svg onload=...>` fits
 * inside twenty characters.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character)
}
