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

/** Who keeps clear under each rule, in the fewest words that tell a sailor which she was. */
const KEPT_CLEAR_BY: Readonly<Record<number, string>> = {
  10: 'port tack',
  11: 'windward',
  12: 'clear astern',
  13: 'still tacking',
  24: 'not racing',
}

/**
 * Why a boat was given a penalty, for the banner. No rule means she touched a mark. A
 * rule this does not know, which only a server it was not written for would send, is
 * named without a reason.
 */
export function penaltyCause(rule: number | undefined): string {
  if (rule === undefined) return 'touched a mark'
  const why = KEPT_CLEAR_BY[rule]
  return why ? `rule ${rule}, ${why}` : `rule ${rule}`
}
