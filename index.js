'use strict';

const { resolve: urlResolve } = require('url');

const { ValidationError } = require('ajv');

const compilePointer = require('./pointer');


/**
 * Modifies an Ajv instance to add `'$ref$data'` and `'async$ref$data'` as new
 * keywords (for sync and async schemas, respectively).
 *
 * @param {Object} ajv - the Ajv instance
 * @param {Object} [opts={}] - the plugin options
 */

module.exports = function (ajv, opts={}) {
  let compile = (...args) => $ref$data(opts, ...args);
  let metaSchema = { items: { type: 'string' }, type: 'array' };

  ajv.addKeyword('$ref$data', { compile, errors: true, metaSchema });
  ajv.addKeyword('async$ref$data', {
    async: true, compile, errors: true, metaSchema
  });

  return ajv;
};


let $pathToPtr = /(?:\[([0-9]+)\]|\.([^.[]+)|\['((?:[^\\']|\\\\|\\')*)'\])/g;

/**
 * (Compilation function for our keywords.)
 * @private
 */

function $ref$data(opts, schema, parentSchema, it) {
  let $async = it.async;
  let $keyword = $async ? 'async$ref$data' : '$ref$data';

  // check whether there are other validation keywords
  checkForExtraRules(parentSchema, $keyword, it);

  // check and compile each pointer
  let $pieces = schema.map((piece, idx) => idx % 2 ? compilePointer(
    piece, `${$keyword}: reference "${piece}" at path "${it.errSchemaPath}`,
    it.dataLevel
  ) : piece);

  // schema to validate (and possibly coerce) the resolved pieces
  let $fragsSchema = it.self.compile({
    items: $pieces.map((_, idx) => idx % 2 ? { type: 'string' } : {})
  });

  // isolate only the values we need within the closure
  let {
    baseId: $baseId,
    opts: { jsonPointers: $jsonPointers }
  } = it;
  let { missingRefs: $missingRefs=it.opts.missingRefs } = opts;
  let $getSchema = it.self.getSchema.bind(it.self);

  // run-time validation function
  return function validate(data, path, parent, keyword, root) {
    // if needed, convert JS paths (such as `.a[0]['~'].b['a\\'b']`) to
    // equivalent JSON pointer (such as "/a/0/~0/b/a'b")
    let jsonPath = path;
    if (!$jsonPointers) jsonPath = jsonPath.replace('~','~0').replace('/','~1')
      .replace($pathToPtr, '/$1$2$3').replace(/\\([\\'])/,'$1');

    // split JSON pointer to current position into path fragments
    let pathFrags = [];
    for (let frag of jsonPath.split('/').slice(1)) pathFrags.push(
      frag.replace('~1', '/').replace('~0', '~')
    );

    // replace odd-position pieces with the pointer outcomes
    let resolvedPieces = [];
    for (let [idx, piece] of $pieces.entries()) resolvedPieces.push(
      idx % 2 ? piece(root, pathFrags) : piece
    );

    // check whether resolved & coerced pieces meet the schema
    if (!$fragsSchema(resolvedPieces)) {
      validate.errors = [];
      for (let err of $fragsSchema.errors) validate.errors.push({
        keyword: $keyword,
        message: 'element pointed to does not meet data schema',
        params: err
      });
      if ($async) throw new ValidationError(validate.errors);
      return false;
    }

    // obtain desired ref, fetch corresponding schema (or report missing)
    let ref = resolvedPieces.join('');
    let refSchema = $getSchema(urlResolve($baseId, ref), it);
    if (!refSchema && $missingRefs != 'ignore') {
      validate.errors = [{
        keyword: $keyword,
        message: `can't resolve reference ${ref} from id ${$baseId}`,
        params: { ref }
      }];
      if ($async) throw new ValidationError(validate.errors);
      return false;
    }
    // if missing schemas are ok, report success if schema is missing
    if (!refSchema) return $async ? Promise.resolve(true) : true;

    // report result
    let refSchemaAsync = refSchema && refSchema.root.$async;
    if ($async) { // if outer schema is async
      let result = refSchema(data, path, parent, keyword, root);
      if (refSchemaAsync) return result; // if inner is async
      // otherwise, inner schema is sync, and we must wrap result
      if (result) return Promise.resolve(true);
      throw new ValidationError(refSchema.errors);
    } else if (refSchemaAsync) { // if outer is sync and inner is async
      validate.errors = [{
        keyword: $keyword,
        message: 'cannot invoke asynchronous subschema',
        params: { ref }
      }];
      return false;
    }
    // otherwise, both outer and inner schemas are sync
    let result = refSchema(data, path, parent, keyword, root);
    validate.errors = refSchema.errors;
    return result;
  };
}

/**
 * Test whether other validation keywords are present. Throw if both keywords
 * are present, or the wrong (sync vs async) version is used. If user set Ajv's
 * `extendRefs` to `'fail'`, throw if more keywords are present. If user set it
 * to `'ignore'`, log a warning that it's not possible.
 *
 * @private
 * @param {Object} parentSchema - the parent schema
 * @param {string} $keyword - the current version of the keyword
 * @param {Object} it - the Ajv schema compilation context
 * @throws {Error} in any of the situations listed above
 */

function checkForExtraRules(parentSchema, $keyword, it) {
  if (Object.keys(parentSchema).every(
    key => key == $keyword || !it.RULES.all[key]
  )) return;

  let where = `in schema at path "${it.errSchemaPath}"`;
  if (!parentSchema[$keyword]) {
    throw new Error(
      `${$keyword}: switched '$ref$data' and 'async$ref$data' ${where}"`
    );
  } else if (parentSchema.async$ref$data && parentSchema.$ref$data) {
    throw new Error(
      `${$keyword}: both '$ref$data' and 'async$ref$data' used ${where}"`
    );
  } else if (it.opts.extendRefs == 'fail') {
    throw new Error(
      `${$keyword}: other keywords used ${where} (see option extendRefs)`
    );
  } else if (it.opts.extendRefs !== true) {
    // eslint-disable-next-line no-console
    console.warn(`${$keyword}: other keywords ${where} cannot be ignored`);
  }
}
