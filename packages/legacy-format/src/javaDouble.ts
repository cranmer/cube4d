/**
 * Formatting doubles the way Java's `Double.toString` does.
 *
 * The `.log` view matrix is written with Java string concatenation, so reproducing a file
 * byte-for-byte means reproducing Java's number formatting exactly. It differs from JavaScript's in
 * three ways that all matter:
 *
 *   value        Java              JavaScript
 *   -----------  ----------------  --------------
 *   1            "1.0"             "1"
 *   -0           "-0.0"            "0"
 *   1e10         "1.0E10"          "10000000000"
 *   2.9e-9       "2.9E-9"          "2.9e-9"
 *   1e21         "1.0E21"          "1e+21"
 *
 * Java switches to scientific notation outside [1e-3, 1e7); JavaScript outside [1e-6, 1e21). Java
 * always keeps a digit on each side of the point, uses a capital `E`, and never writes `+` on the
 * exponent.
 *
 * The digits themselves are the same in both languages: each produces the shortest decimal that
 * round-trips to the same double, which is unique. So we take JavaScript's digits and re-render
 * them under Java's layout rules.
 */

/**
 * Format a number as Java's `Double.toString` would.
 *
 * Handles the finite cases the log format can contain. `NaN` and the infinities are formatted the
 * way Java writes them, though a view matrix should never hold one.
 */
export function javaDoubleToString(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';

  // Object.is distinguishes -0 from 0, which `value < 0` does not.
  const negative = value < 0 || Object.is(value, -0);
  const sign = negative ? '-' : '';
  const magnitude = Math.abs(value);

  if (magnitude === 0) return `${sign}0.0`;

  // toExponential() with no argument yields the shortest digits that uniquely identify the value.
  const [mantissa, exponentText] = magnitude.toExponential().split('e');
  const exponent = Number(exponentText);
  const digits = mantissa.replace('.', '');

  if (magnitude >= 1e-3 && magnitude < 1e7) {
    return sign + plainDecimal(digits, exponent);
  }
  // Scientific: exactly one digit before the point, at least one after, capital E, no leading +.
  const fraction = digits.length > 1 ? digits.slice(1) : '0';
  return `${sign}${digits[0]}.${fraction}E${exponent}`;
}

/**
 * Render `digits` scaled by 10^exponent as a plain decimal with at least one digit on each side of
 * the point. `exponent` is the power of ten of the leading digit.
 */
function plainDecimal(digits: string, exponent: number): string {
  if (exponent >= 0) {
    if (exponent + 1 >= digits.length) {
      // Integral: pad with zeros, then Java's mandatory ".0".
      return digits + '0'.repeat(exponent + 1 - digits.length) + '.0';
    }
    return `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
  }
  return `0.${'0'.repeat(-exponent - 1)}${digits}`;
}

/**
 * Parse a number written by Java. `Number()` accepts Java's `E` notation directly; this exists to
 * name the operation and to reject junk loudly rather than silently yielding NaN.
 */
export function parseJavaDouble(text: string, context: string): number {
  const value = Number(text);
  if (Number.isNaN(value) && text.trim() !== 'NaN') {
    throw new Error(`${context}: cannot parse "${text}" as a number`);
  }
  return value;
}
