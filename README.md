ajv-refdata
===========

[![Build Status](https://travis-ci.org/jboavida/ajv-refdata.svg?branch=master)](https://travis-ci.org/jboavida/ajv-refdata)
[![Greenkeeper badge](https://badges.greenkeeper.io/jboavida/ajv-refdata.svg)](https://greenkeeper.io/)

Add keywords `$ref$data` and `async$ref$data` to [Ajv](https://github.com/epoberezkin/ajv).

`$ref$data` is a custom keyword for JSON schema. It takes an array of strings and `$data` pointers, generates a schema id from them, and invokes that schema with `$ref`. This package adds the keyword to an Ajv instance.

(This is probably clear, but just in case: this is a package _for_ Ajv, but it is not affiliated with it.)


Contents
--------

- [Example and description](#example-and-description)
- [Installation and usage](#installation-and-usage)
- [Options and behavior](#options-and-behavior)
  - [Other keywords in the schema; asynchronous schemas](#other-keywords-in-the-schema-asynchronous-schemas)
  - [Maximum depth for relative pointers](#maximum-depth-for-relative-pointers)
  - [JSON pointers vs data paths](#json-pointers-vs-data-paths)
  - [Validation of the data values](#validation-of-the-data-values)
  - [Resolution of the schema id; nested `$ref` and `$ref$data`](resolution-of-the-schema-id-nested-ref-and-ref$data)
  - [Missing schemas](#missing-schemas)
- [Future changes; semantic versioning](#future-changes-semantic-versioning)
- [Contributions](#contributions)
- [License](#license)


Example and description
-----------------------

`$ref$data` is a mix of `$ref` with `$data`. The schema
```json
{
  "$ref$data": [
    "string0", "string1", "string2", "string3", "string4"
  ]
}
```
first replaces the odd-numbered strings by the result of the corresponding `$data` object (for example, `"string1"` is replaced by the result of `{ "$data": "string1" }`), joins all the resulting strings (both the unchanged even- and the replaced odd-numbered), and invokes (as with `$ref`) the schema with the id thus obtained. Relative pointers are resolved relative to the object to which the schema applies.

The purpose of this keyword is to let the applicable schema be determined based on parts of the data. In a natural scenario, the schema
```json
{
  "$id": "/complex",
  "definitions": {
    "b": { "properties": { "value": { "type": "boolean" } } },
    "i": { "properties": { "value": { "type": "integer" } } }
  },
  "items": { "$ref$data": ["/complex#/definitions/", "0/type"] },
  "type": "array"
}
```
will validate `[{ type: 'i', value: 4 }, { type: 'b', value: false }]` but not `[{ type: 'b', value: 5 }]`.

For a more detailed example, say we are validating the object
```js
let obj = {
  a: {
    b: { c: "d" },
    e: [1, 2, 3],
    f: "g"
  }
}
```
and that the schema that applies to `obj.a.e[2]` is
```json
{
  "$ref$data": [
    "/", "/a/b/c", "o", "2/f", "#", "1#", "", "2#", "ts"
  ]
}
```

The odd-numbered strings (`"/a/b/c"`, `"2/f"`, `"1#"`, `"2#"`) are first interpreted as [JSON pointers](https://tools.ietf.org/html/rfc6901) or [relative JSON pointers](https://tools.ietf.org/html/draft-handrews-relative-json-pointer-01) and processed as if they were `$data` references. So:
- `"/a/b/c"` is processed as `{ "$data": "/a/b/c" }`, it points to `obj.a.b.c`, and the result is `"d"`;
- `"2/f"` is evaluated relative to the starting point `obj.a.e[2]`, so it refers to `obj.a.f` and the result is `"g"`;
- `"1#"` points to the last key in `obj.a.e`, which is `"e"`;
- `"2#"` points to the last key in `obj.a`, which is `"a"`.

In the end, the array turns into `["/", "d", "o", "g", "#", "e", "", "a", "ts"]` and so the subschema is processed as
```json
{ "$ref": "/dog#eats" }
```
and that id is resolved according to the normal rules.

The following situations are always rejected at compilation time (an an exception is thrown):
- values of `$ref$data` that are not arrays of strings;
- invalid pointers (such as `"2##a/b/c"`);
- relative pointers to values above the root object (such as `"4/any/thing"`, which would attempt to point to an ancestor of `obj`);
- relative pointers to keys above the root object (such as `"3#"`, which would ask for the name of `obj` within itself).

Valid pointers that point to nonexisting locations (in the example above, `"/a/c/d"` would point to `obj.a.c.d`, and so would `"2/c/d"` evaluated from `obj.a.e[2]`) resolve to `undefined`. When some array items resolve to `undefined`, validation of `$ref$data` always fails.

`$ref$data` only works in sync schemas. The keyword `async$ref$data` works exactly in the same way, but only for async schemas.

Some [options](#options-and-behavior) affect validation for specific cases.


Installation and usage
----------------------

The package is available for [Node.js](https://nodejs.org/) (6, 8, or 9), at [npm](https://www.npmjs.com/). It is installed with
```sh
$ npm install ajv-refdata
```
and invoked as in
```js
let Ajv = require('ajv');
let ajv = Ajv();

let ajvRefdata = require('ajv-refdata');
ajvRefdata(ajv);
```
(or `ajvRefdata(ajv, options)`, to set package options to be used in that Ajv instance).


Options and behavior
--------------------

Whenever possible, I tried to follow Ajv's options, including [those set](https://github.com/epoberezkin/ajv#options) [when creating an Ajv instance](https://github.com/epoberezkin/ajv#new-ajvobject-options---object). These
```js
let ajv = Ajv({
  coerceTypes: true,
  extendRefs: 'fail',
  inlineRefs: false,
  jsonPointers: true,
  missingRefs: 'ignore'
});
```
are the options (and some of the values) relevant to ajv-refdata. The package itself accepts the following option
```js
ajvRefdata(ajv, {
  missingRefs: 'ignore'
});
```
which (if provided) is used instead of the Ajv instance's own `missingRefs`.


### Other keywords in the schema; asynchronous schemas

`$ref$data` is very similar to `$ref` and I try to handle the presence of other keywords in the same way. But there are some differences:
- `$ref$data` can only appear in sync schemas;
- `async$ref$data` can only appear in async schemas;
- if the instance has `extendRefs: true`, other validation keywords are applied (just as for `$ref`);
- if the instance has `extendRefs: 'fail'` and other validation keywords are present, the schema is not accepted (just as for `$ref`);
- if the instance has `extendRefs: 'ignore'` (or undefined, or a value other than `true` or `'fail'`) than a warning is logged but *the other validation keywords are applied too* (this is *not* what `$ref` does, but custom keywords cannot currently prevent the use of other keywords).


### Maximum depth for relative pointers

When schemas are invoked from other schemas, relative pointers can only be used if they point inside the root of the embedded schema. Global pointers are always resolved with respect to the topmost object.


### JSON pointers vs data paths

Usually, Ajv tells custom keywords what the current data path is, in a format convenient for code generation (which is the intended use case). For example, if the topmost object is `obj` and we are currently validating `obj.a.e[2]`, custom keywords receive `".a.e[2]"` as the data path. However, ajv-refdata also needs access to the intermediate objects, and for that I convert that path to a JSON pointer `"/a/e/2"`.

If the Ajv instance has `jsonPointers: true`, then that conversion is not needed nor done.


### Validation of the data values

The results of evaluating the `$data` pointers must be strings, or else validation fails.

For consistency, if the Ajv instance has `coerceTypes: true`, then Ajv's type coercion applies: numbers and booleans are converted to strings, `null` is converted to `''`, and other values (including `undefined`, if the pointer doesn't resolve to an existing position) don't pass validation. `coerceTypes: 'array'` is honored too.


### Resolution of the schema id; nested `$ref` and `$ref$data`

The requested schema id should be an URI reference, and is resolved with respect to the current base id. The resolution is done using node's `url.resolve` without checking in advance whether the unresolved id is really an URI reference. (`url.resolve` does any URI escaping that may be needed.)

There is some ambiguity in how the base id is supposed to change when moving into a schema that doesn't have its own id. For example, with the schema
```json
{ "$id": "/top/level", "definitions": { "inner": { "schema": "without id" } } }
```
if no `"$id"` is specified directly on the inner schema (reachable with `"/top/level#/definitions/inner"`), then the base id could either stay whatever it was before, or change to `"/top/level#/definitions/inner"`, depending on how implementations address the ambiguity.

Moreover, if the referred schema's URI starts with `#`, it can only be resolved from within a schema with a specified base id. For example,
```json
{
  "definitions": { "one": {} },
  "$ref$data": ["#/definitions/one"]
}
```
can only work if an `"$id"` is added at the top level.

`$ref$data` always invokes schemas separately (and so changes the base id). Ajv does the same for `$ref` when the instance has `inlineRefs: false`. Currently (version 6.4.0), when using `inlineRefs: true` (the default), schemas invoked with `$ref` can be directly inlined, and in that case the base id does not change.

The issue can be avoided by either not nesting `$ref$data` within schemas fetched with `$ref`, or by using `$ref$data` only to build schemas ids that are absolute URIs. Of course, using `$ref$data` to build schema ids that are relative URIs is probably not a good idea anyways: as the ids are generated at run-time only, it's not obvious, by looking at the schema, what the ultimate id will be. So, changes in the outer schema could very easily introduce errors that would be hard to debug (especially if incorrectly resolved ids also point to existing schemas).


### Missing schemas

`$ref$data` tries to handle missing schemas in the same way that `$ref` does, but there are differences:
- if `missingRefs` was set [when adding the keyword](#options-and-behavior), then that value supersedes the instance's;
- if the instance (or package) has `missingRefs: 'ignore'`, then validation succeeds;
- if the instance (or package) has `missingRefs: 'fail'`, validation fails (this condition can be determined only at run-time, so *no error is logged during compilation*);
- if the instance (or package) has `missingRefs: true` (or any value other than `'ignore'`), then validation fails.


Future changes; semantic versioning
------------------------------------

This package started as a submodule of another project. Some months later, it made sense to factor it out as a stand-alone module and clean it up. It is not likely to change much, because it currently does all the other project needs from it, and needs to keep meeting those needs.

I intend to follow semantic versioning. At the moment, these are the likely changes:
- I would prefer if `extendRefs: 'ignore'` did deactivate other keywords in the same schema as `$ref$data`; I'm likely to fix the [current behavior](#other-keywords-in-the-schema-asynchronous-schemas) if I figure out how to do it;
- I may drop `async$ref$data` (or make both keywords work with both types of schemas, or some similar variation) if I find a way to make the same keyword work both for sync and async schemas;
- if the exact details of [data paths](#json-pointers-vs-data-paths) change too much (this would not even require a patch version change in Ajv; however, given the way data paths are used in Ajv, it seems unlikely they would change), or if I did not implement the conversion correctly, `jsonPointers: true` may be needed until I make corresponding changes here;
- so far I've only used string values (for the `$data` results), but maybe the [validation of data values](#validation-of-the-data-values) could be less strict.


Contributions
-------------

Until I'm confident the package is sufficiently stable, I won't accept code contributions.

Issues (bug reports, suggestions, etc.) are welcome, but I may take some time to get to them.


License
-------

Copyright © 2017–2018 João Pedro Boavida. Licensed under the [MIT License](LICENSE).
