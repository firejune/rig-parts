/**
 * Reserved: the ComfyUI adapter (image generation and the See-through run).
 *
 * `src/` is pure — no clock, no randomness, no network — and this directory is
 * the one exception it will have, because driving a GPU box IS a network call
 * with a wall-clock wait. Keeping the exception to one named directory is what
 * keeps the rule checkable: the selftest's purity control scans every file in
 * `src/` except this directory, and a network call that appears anywhere else
 * is refused by name.
 *
 * Nothing is implemented here yet; `spine-parts comfy` says so and exits 2.
 * ComfyUI is optional: See-through can be run by any route in the README, and
 * everything after it reads files.
 */
export const COMFY_ADAPTER_IMPLEMENTED = false;
