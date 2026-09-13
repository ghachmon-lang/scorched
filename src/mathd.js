// Deterministic math helpers. Basic IEEE-754 arithmetic (+ - * / sqrt) is
// bit-identical across JavaScript engines, but transcendental functions
// (sin, cos, atan2, hypot, pow) are not guaranteed to be. We quantize their
// results so that a last-bit difference between, say, V8 on Android and
// JavaScriptCore on iOS can never diverge an online game.
const Q = 1e6;
export const DEG = Math.PI / 180;

export function dsin(rad) {
  return Math.round(Math.sin(rad) * Q) / Q;
}
export function dcos(rad) {
  return Math.round(Math.cos(rad) * Q) / Q;
}
export function datan2(y, x) {
  return Math.round(Math.atan2(y, x) * Q) / Q;
}
/** Length of a vector, without Math.hypot (whose precision is implementation-defined). */
export function dlen(x, y) {
  return Math.sqrt(x * x + y * y);
}
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function sign(v) {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}
