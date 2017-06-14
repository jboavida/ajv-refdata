'use strict';

module.exports = compilePointer;


/**
 * Convert a (relative) JSON pointer into a function that receives an object and
 * an array of fragments (with the sequence of indices and property names to go
 * from the object to the position from which relative pointers are resolved)
 * and returns the value identified by the pointer (or `undefined`, if the value
 * cannot be reached).
 *
 * @param {string} pointer  - a JSON pointer or relative JSON pointer
 * @param {string} [msg] - initial string for error messages
 * @param {number} [maxDepth] - limit of up steps (see {@link checkSpec})
 * @return {function(Object, string[])} - obtained from {@link pointerFn}
 */

function compilePointer(pointer, msg='reference', maxDepth=Infinity) {
  let spec = breakPointer(pointer);
  checkSpec(spec, msg, maxDepth);
  return pointerFn(spec);
}


let pointerParts = /^(?:(0|[1-9][0-9]*)(#$)?)?((?:\/(?:[^~/]|~0|~1)*)*)$/;

let unescapeFrag = s => s.replace('~1', '/').replace('~0', '~');

/**
 * Convert a pointer into information about the type of pointer (absolute,
 * relative value, or relative key), the number of levels to go up (relative
 * pointers only), and the array of fragments to follow (relative value and
 * absolute pointers only). Invalid pointers are converted to `null`.
 *
 * @example
 * breakPointer('/a/~0b/2') == { absolute: true, frags: ['a', '~b', '2'] }
 *
 * @example
 * breakPointer('4/~1a/b') == { frags: ['/a', 'b'], up: 4, value: true }
 *
 * @example
 * breakPointer('6#') == { key: true, up: 6 }
 *
 * @example
 * breakPointer('2##a/b/c') == null
 *
 * @private
 * @param {string} pointer
 * @return {Object}
 */

function breakPointer(pointer) {
  let parts = pointer.match(pointerParts);
  if (!parts) return null;

  let up = +parts[1]; // up = NaN if pointer absolute
  if (parts[2]) return { key: true, up };
  let frags = parts[3].split('/').slice(1).map(unescapeFrag);
  if (Number.isNaN(up)) return { absolute: true, frags };
  return { value: true, frags, up };
}

/**
 * Check pointer spec (obtained from {@link breakPointer}) for error conditions
 * and throw exceptions. When a maximum depth is specified, the item that is
 * that number of levels up from the current position is treated as the object
 * root for assessing whether a relative pointer is acceptable.
 *
 * For example, if the current position is `root.a.b[4]` (3 levels down from
 * `root`), the pointer "2" points to `root.a`, "2/c" point to `root.a.c` and
 * "2#" points to `"a"`. However, "3#" cannot be resolved, as "3" points to
 * `root`, and "4" or "4/a" cannot be resolved either. Absolute pointers are
 * always ok (always resolved from the top object). If no depth is specified,
 * all valid pointers are ok. Invalid pointers are always rejected.
 *
 * @example
 * checkSpec(breakPointer("2"), '', 3)      // "2" is ok at depth 3
 * checkSpec(breakPointer("2/c"), '', 3)    // "2/c" is ok too
 * checkSpec(breakPointer("2#"), '', 3)     // "2#" is ok too
 * checkSpec(breakPointer("3#"), '', 3)     // throws for keys at root or above
 * checkSpec(breakPointer("4"), '', 3)      // throws for values above root
 * checkSpec(breakPointer("4/a"), '', 3)    // throws for values above root
 * checkSpec(breakPointer("/a/b/c"), '', 3) // absolute pointers are ok
 * checkSpec(breakPointer("2##"), '', 3)    // throws for invalid pointers
 *
 * @private
 * @param {Object} spec - obtained from {@link breakPointer}
 * @param {string} [msg] - beginning of error message for thrown errors
 * @param {number} [maxDepth=Infinity] - maximum depth
 * @throws {Error} if pointer is invalid
 * @throws {Error} if pointer asks for key at or above `maxDepth` levels up
 * @throws {Error} if pointer asks for value above `maxDepth` levels up
 */

function checkSpec(spec, msg='reference', maxDepth=Infinity) {
  if (!spec) throw new Error(msg + ' is not a valid pointer');

  if (spec.absolute) return; // absolute pointers are always ok

  let { up } = spec;
  let levels = `${up} level${up != 1 ? 's' : ''}`;
  if (spec.key && up >= maxDepth) {
    if (maxDepth == 0) throw new Error(
      `${msg} asks for key ${levels} up, already at root`
    );
    throw new Error(
      `${msg} asks for key ${levels} up, maximum is ${maxDepth - 1}`
    );
  } else if (spec.value && up > maxDepth) {
    throw new Error(
      `${msg} asks for value ${levels} up, maximum is ${maxDepth}`
    );
  }
}

/**
 * Generate function from a valid spec obtained with {@link breakPointer}. The
 * function receives an object and an array of path fragments (pointing to the
 * current position), and returns the corresponding value. The function takes
 * shortcuts that are valid only if the conditions checked by {@link checkSpec}
 * still hold and the path fragments (for the current position) point to an
 * existing location in the object. Absolute pointers ignore the path fragments,
 * relative pointers to values return `undefined` if the starting position does
 * not exist or the target is outside the object, and relative pointers to keys
 * rely exclusively on the path fragments (and return `undefined` if the target
 * key is above the first fragment).
 *
 * @example
 * let obj = { a: { "~b": [1, 2, 3] }, "/c": [5, 6] };
 * let absolute = pointerFn(breakPointer("/a/~0b/2"));
 * absolute(obj) == 3
 * let value = pointerFn(breakPointer("2"));
 * value(obj, ["a", "~b"]) == obj;
 * value(obj, ["a", "~b", 0]) == obj.a;
 * value(obj, ["/c"]) == undefined;
 * value(obj, ["d", "e", "f"]) == undefined;
 * let key = pointerFn(breakPointer("2#"));
 * key(obj, ["a", "~b"]) == undefined;
 * key(obj, ["a", "~b", 0]) == "a";
 * key(obj, ["a", "~b", 10]) == "a";
 * key(obj, ["d", "e", "f"]) == "d";
 *
 * @private
 * @param {Object} spec - obtained from {@link breakPointer}
 * @return {function(Object, string[])}
 */

function pointerFn(spec) {
  let { frags, up } = spec;
  if (spec.key) {
    // eslint-disable-next-line no-unused-vars
    return function (_, pathFrags) {
      return pathFrags[pathFrags.length - up - 1];
    };
  } else if (spec.absolute) {
    return function (moving) {
      for (let frag of frags) moving = moving && moving[frag];
      return moving;
    };
  }
  return function (moving, pathFrags) {
    let j = pathFrags.length - up;
    if (j < 0) return undefined;
    for (let i = 0; i < j; i++) moving = moving && moving[pathFrags[i]];
    for (let frag of frags) moving = moving && moving[frag];
    return moving;
  };
}
