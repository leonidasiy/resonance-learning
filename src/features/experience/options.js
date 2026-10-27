// @ts-check
/** @typedef {Pick<Storage, "getItem"|"setItem">} OptionStorage */

/** @template T
 * @param {OptionStorage|undefined} storage
 * @param {string} key
 * @param {(value:unknown)=>value is T} validate
 * @param {(message:string)=>void} onError
 * @returns {T|null}
 */
export function loadOptions(storage, key, validate, onError) {
  try {
    const raw = storage?.getItem(key);
    if (raw == null) return null;
    const value = JSON.parse(raw);
    if (validate(value)) return value;
    onError("Saved options could not be restored. Choose your options again.");
  } catch {
    onError("Saved options could not be read in this browser.");
  }
  return null;
}

/** @param {OptionStorage|undefined} storage @param {string} key @param {unknown} value @param {(message:string)=>void} onError */
export function saveOptions(storage, key, value, onError) {
  try { storage?.setItem(key, JSON.stringify(value)); }
  catch { onError("Your options could not be saved in this browser."); }
}
