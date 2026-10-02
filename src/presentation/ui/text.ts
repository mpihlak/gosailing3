const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Make a value safe to put in markup.
 *
 * The boards are built by interpolating into `innerHTML`, and what goes into them came
 * off a socket. Which server that socket goes to is a query parameter, so it is not
 * necessarily one of ours, and nothing it sends is the type it claims: a `place` the
 * protocol calls a number arrives as whatever was written on the wire. Taking `unknown`
 * is the point — every value from the far end goes through here, whatever its type says.
 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character)
}

/**
 * A color, if it is one we are willing to put in a style attribute.
 *
 * Escaping is the wrong tool here: an escaped quote is not a color, so a name that
 * needed escaping was never going to draw anything. Hex is what the fleet is painted in,
 * and anything else is dropped rather than patched up.
 */
export function cssColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : undefined
}
