
const chai = require('chai');
chai.use(require('chai-as-promised'));
chai.use(require('dirty-chai'));

const { expect } = chai;

const co = require('co');

const Ajv = require('ajv');
const ajvVersion = require('ajv/package.json').version;

const ajvAsync = require('ajv-async');

const ajvRefdata = require('.');
const compilePointer = require('./pointer');

function ajvWithOptions(ajvOpts, pluginOpts) {
  ajvOpts = Object.assign({}, ajvOpts);
  if (ajvVersion.match(/^4/)) Object.assign(ajvOpts, { v5: true });
  if (ajvVersion.match(/^6/)) Object.assign(ajvOpts, { schemaId: 'auto' });
  let ajv = Ajv(ajvOpts);
  if (process.version.match(/^v6/) && ajvVersion.match(/^6/)) ajvAsync(ajv);
  return ajvRefdata(ajv, pluginOpts);
}


describe(`pointer compiler`, function () {
  it(`rejects $data reference to value above root`, function () {
    expect(() => compilePointer('1/a/b', '', 0)).to.throw();
    expect(() => compilePointer('3/a/b', '', 2)).to.throw();
    expect(() => compilePointer('5/~0a/~1/b#', '', 3)).to.throw();
    expect(() => compilePointer('5/~0a/~1/b#', '', 5)).not.to.throw();
    expect(() => compilePointer('5/~0a/~1/b#', '')).not.to.throw();
  });

  it(`rejects $data reference to key above root`, function () {
    expect(() => compilePointer('0#', '', 0)).to.throw();
    expect(() => compilePointer('1#', '', 2)).not.to.throw();
    expect(() => compilePointer('2#', '', 2)).to.throw();
    expect(() => compilePointer('3#', '', 2)).to.throw();
    expect(() => compilePointer('3#', '', 4)).not.to.throw();
    expect(() => compilePointer('3#', '')).not.to.throw();
  });

  it(`rejects invalid $data reference`, function () {
    expect(() => compilePointer('0#4', '', 2)).to.throw();
    expect(() => compilePointer('0/~', '', 2)).to.throw();
    expect(() => compilePointer('0/~', '')).to.throw();
  });

  it(`correctly processes absolute pointers`, function () {
    // doc and pairs from https://tools.ietf.org/html/rfc6901#section-5
    let doc = {
      "foo": ["bar", "baz"],
      "": 0,
      "a/b": 1,
      "c%d": 2,
      "e^f": 3,
      "g|h": 4,
      "i\\j": 5,
      "k\"l": 6,
      " ": 7,
      "m~n": 8
    };
    let pairs = [
      ["", doc],
      ["/foo", ["bar", "baz"]],
      ["/foo/0", "bar"],
      ["/", 0],
      ["/a~1b", 1],
      ["/c%d", 2],
      ["/e^f", 3],
      ["/g|h", 4],
      ["/i\\j", 5],
      ["/k\"l", 6],
      ["/ ", 7],
      ["/m~0n", 8]
    ];
    let doc2 = { a: 4, b: { c: 'bso' } };
    let doc3 = { a: [{ b: [4], c: 'a' }] };
    let doc4 = { a: { "~b": [1, 2, 3] }, "/c": [5, 6] };
    let doc5 = { a: { b: { c: 'd' }, e: [1, 2, 3], f: 'g' } };
    let tests = [
      ...pairs.map(([ptr, ans]) => [ptr, doc, ans]),
      ["/foo/2", doc, undefined],
      ["/b/c", doc2, 'bso'],
      ["/a/0/c", doc3, 'a'],
      ["/a/~0b/2", doc4, 3],
      ["/a/b/c", doc5, "d"]
    ];
    for (let [ptr, doc, ans] of tests) {
      expect(compilePointer(ptr)(doc)).to.eql(ans);
    }
  });

  it(`correctly processes relative pointers to values`, function () {
    // doc and triples adapted from
    // https://tools.ietf.org/html/draft-luff-relative-json-pointer-00#section-5
    let doc = {
      "foo": ["bar", "baz"],
      "highly": {
        "nested": {
          "objects": true
        }
      }
    };
    let triples = [
      ["0", ["foo", "1"], "baz"],
      ["1/0", ["foo", "1"], "bar"],
      ["2/highly/nested/objects", ["foo", 1], true],
      ["0/objects", ["highly", "nested"], true],
      ["1/nested/objects", ["highly", "nested"], true],
      ["2/foo/0", ["highly", "nested"], "bar"]
    ];
    let doc2 = [{ a: 4, "\\'b": { c: 'la' }, "~c#": 'two' }, 5];
    let doc3 = { b: [4], c: 'a' };
    let doc4 = { a: { "~b": [1, 2, 3] }, "/c": [5, 6] };
    let doc5 = { a: { b: { c: 'd' }, e: [1, 2, 3], f: 'g' } };
    let tests = [
      ...triples.map(([ptr, path, ans]) => [ptr, doc, path, ans]),
      ["3", doc, ["highly", "nested"], undefined],
      ["3/a", doc, ["highly", "nested"], undefined],
      ["1/0/~0c#", doc2, [1], 'two'],
      ["1/\\'b/c", doc2, [0, 'a'], 'la'],
      ["2/~0c#", doc2, [0, "\\'b", 'c'], 'two'],
      ["2/c", doc3, ['b', 1], 'a'],
      ["2/c", { a: [doc3] }, ['a', 0, 'b', 1], 'a'],
      ["2", doc4, ["a", "~b"], doc4],
      ["2", doc4, ["/c"], undefined],
      ["2", doc4, ["d", "e", "f"], undefined],
      ["2/f", doc5, ["a", "e", 2], "g"]
    ];
    for (let [ptr, doc, path, ans] of tests) {
      expect(compilePointer(ptr)(doc, path)).to.eql(ans);
    }
  });

  it(`correctly processes relative pointers to keys`, function () {
    // doc and triples adapted from
    // https://tools.ietf.org/html/draft-luff-relative-json-pointer-00#section-5
    let doc = {
      "foo": ["bar", "baz"],
      "highly": {
        "nested": {
          "objects": true
        }
      }
    };
    let triples = [
      ["0#", ["foo", 1], 1],
      ["1#", ["foo", 1], "foo"],
      ["0#", ["highly", "nested"], "nested"],
      ["1#", ["highly", "nested"], "highly"]
    ];
    let doc2 = { la: [5, 4] };
    let doc3 = { a: [{ b: [4] }] };
    let doc4 = { a: { "~b": [1, 2, 3] }, "/c": [5, 6] };
    let doc5 = { a: { b: { c: 'd' }, e: [1, 2, 3], f: 'g' } };
    let tests = [
      ...triples.map(([ptr, path, ans]) => [ptr, doc, path, ans]),
      ["2#", doc, ["foo", 1], undefined],
      ["3#", doc, ["highly", "nested"], undefined],
      ["0#", doc2, ['la', 0], 0],
      ["1#", doc2, ['la', 1], 'la'],
      ["1#", doc3, ['a', 0, 'b', 0], 'b'],
      ["2#", doc4, ["a", "~b"], undefined],
      ["2#", doc4, ["a", "~b", 0], "a"],
      ["2#", doc4, ["a", "~b", 10], "a"],
      ["2#", doc4, ["d", "e", "f"], "d"],
      ["1#", doc5, ["a", "e", 2], "e"],
      ["2#", doc5, ["a", "e", 2], "a"]
    ];
    for (let [ptr, doc, path, ans] of tests) {
      expect(compilePointer(ptr)(doc, path)).to.eql(ans);
    }
  });
});


describe(`$ref$data`, function () {
  it(`enforces meta-schema`, function () {
    let ajv = ajvWithOptions();
    let schema = {
      items: { $ref$data: ['a', {}]}
    };
    expect(() => ajv.compile(schema)).to.throw();
  });

  it(`rejects 'async$ref$data' in sync schema`, function () {
    let ajv = ajvWithOptions();
    let schema = {
      items: { async$ref$data: ['b'] }
    };
    expect(() => ajv.compile(schema)).to.throw();
  });

  it(`rejects sibling 'async$ref$data'`, function () {
    let ajv = ajvWithOptions();
    let schema = {
      items: { async$ref$data: ['a'], $ref$data: ['b'] }
    };
    expect(() => ajv.compile(schema)).to.throw();
  });

  it(`rejects sibling keywords if 'extendRefs' set to 'fail'`, function () {
    let ajv = ajvWithOptions({ extendRefs: 'fail' });
    let schema = {
      items: { maximum: 4, $ref$data: ['a']}
    };
    expect(() => ajv.compile(schema)).to.throw();
  });

  it(`tolerates sibling keywords if 'extendRefs' set to false`, function () {
    let ajv = ajvWithOptions({ extendRefs: false });
    let schema = {
      items: { maximum: 4, $ref$data: ['a']}
    };
    expect(() => ajv.compile(schema)).not.to.throw();
  });

  it(`accepts sibling keywords if 'extendRefs' set to true`, function () {
    let ajv = ajvWithOptions({ extendRefs: true });
    let schema = {
      items: { maximum: 4, $ref$data: ['a']}
    };
    expect(() => ajv.compile(schema)).not.to.throw();
  });

  context(`while creating schema id`, function () {
    it(`converts data path to pointer before resolving $data`, function () {
      let ajv = ajvWithOptions( { schemas: [
        { id: 'any', enum: [4] }
      ] });
      let test = ajv.compile({
        properties: { a: { items: {
          properties: { "~": { properties: { b: {
            properties: { "a'b": { $ref$data: ['any'] } }
          } } } }
        } } }
      });
      test({ a: [{ "~": { b: { "a'b": 4 } } }] });
      expect(test.errors || []).to.eql([]);
      expect(test({ a: [{ "~": { b: { "a'b": 5 } } }] })).not.to.be.ok();
    });

    it(`does not convert path if 'jsonPointers' set to true`, function () {
      let ajv = ajvWithOptions({ jsonPointers: true, schemas: [
        { id: 'any', enum: [4] }
      ] });
      let test = ajv.compile({
        properties: { a: { items: {
          properties: { "~": { properties: { b: {
            properties: { "a'b": { $ref$data: ['any'] } }
          } } } }
        } } }
      });
      test({ a: [{ "~": { b: { "a'b": 4 } } }] });
      expect(test.errors || []).to.eql([]);
      expect(test({ a: [{ "~": { b: { "a'b": 5 } } }] })).not.to.be.ok();
    });

    it(`replaces absolute $data reference`, function () {
      let ajv = ajvWithOptions({ schemas: [
        { id: 'absolute', enum: [4] }
      ] });
      let test = ajv.compile({
        properties: { a: { $ref$data: ['a', '/b/c', 'lute'] } }
      });
      test({ a: 4, b: { c: 'bso' } });
      expect(test.errors || []).to.eql([]);
      expect(test({ a: 5, b: { c: 'bso' } })).not.to.be.ok();
    });

    it(`replaces relative $data reference to value`, function () {
      let ajv = ajvWithOptions({ schemas: [
        { id: 'relative', enum: [4] },
        { id: 'two-up', enum: [5] }
      ] });
      let test = ajv.compile({
        additionalItems: { $ref$data: ['', "1/0/~0c#", '-up'] },
        items: [{
          properties: { a: { $ref$data: ['re', "1/\\'b/c", 'tive'] } }
        }]
      });
      test([{ a: 4, "\\'b": { c: 'la' }, "~c#": 'two' }, 5]);
      expect(test.errors || []).to.eql([]);
      expect(test([
        { a: 5, "\\'b": { c: 'la' }, "~c#": 'two' }, 5
      ])).not.to.be.ok();
      expect(test([
        { a: 4, "\\'b": { c: 'la' }, "~c#": 'two' }, 6
      ])).not.to.be.ok();
    });

    it(`replaces relative $data reference to key`, function () {
      let ajv = ajvWithOptions({ schemas: [
        { id: 'relative', enum: [4] },
        { id: '0-up', enum: [5] }
      ] });
      let test = ajv.compile({
        properties: {
          la: {
            additionalItems: { $ref$data: ['re', "1#", 'tive'] },
            items: [{ $ref$data: ['', '0#', '-up'] }]
          }
        }
      });
      test({ la: [ 5, 4 ] });
      expect(test.errors || []).to.eql([]);
      expect(test({ la: [ 5, 6 ] })).not.to.be.ok();
      expect(test({ la: [ 4, 4 ] })).not.to.be.ok();
    });

    it(`checks that $data references point to valid data`, function () {
      let ajv = ajvWithOptions({ schemas: [ { id: 'check-true' } ]});
      let test = ajv.compile({
        properties: { target: { $ref$data: ['check-', '/pointer'] } }
      });
      expect(test({ pointer: true, target: 4 })).not.to.be.ok();
    });

    it(`checks that $data references point to valid data (data coercion)`
    , function () {
      let ajv = ajvWithOptions({ coerceTypes: true, schemas: [
        { id: 'check-true', type: 'integer' }
      ]});
      let test = ajv.compile({
        properties: { target: { $ref$data: ['check-', '/pointer'] } }
      });
      test({ pointer: true, target: 4 });
      expect(test.errors || []).to.eql([]);
      expect(test({ pointer: 'true', target: 's' })).not.to.be.ok();
      test({ pointer: 'true', target: 4 });
      expect(test.errors || []).to.eql([]);
    });

    it(`checks that $data references point to valid data (array coercion)`
    , function () {
      let ajv = ajvWithOptions({ coerceTypes: 'array', schemas: [
        { id: 'check-true', type: 'integer' }
      ]});
      let test = ajv.compile({
        properties: { target: { $ref$data: ['check-', '/pointer'] } }
      });
      test({ pointer: [true], target: 4 });
      expect(test.errors || []).to.eql([]);
      expect(test({ pointer: 'true', target: 's' })).not.to.be.ok();
      test({ pointer: 'true', target: 4 });
      expect(test.errors || []).to.eql([]);
    });

    it(`checks that $data references point to valid data (multiple errors)`
    , function () {
      let ajv = ajvWithOptions({ allErrors: true });
      let test = ajv.compile({
        properties: { target: { $ref$data: [
          'any', '/a/0', 'any', '1/b', 'any', '0/c'
        ] } }
      });
      test({ a: [true], b: null, c: 4, target: 4 });
      expect(test.errors).to.have.lengthOf(3);
      test.errors.forEach((err, idx) => {
        expect(err).to.have.deep.nested.property(
          'params.dataPath', `[${2 * idx + 1}]`
        );
        expect(err).to.have.deep.nested.property('dataPath', '.target');
      });
    });
  });

  context(`while invoking $ref'd schema`, function () {
    it(`rejects nonexisting schema if 'missingRefs' not set to 'ignore'`
    , function () {
      let ajv = ajvWithOptions({ missingRefs: true, schemas: [
        { id: 'exists' }
      ] });
      let test = ajv.compile({ $ref$data: ['', '/a'] });
      test({ a: 'exists' });
      expect(test.errors || []).to.eql([]);
      expect(test({ a: 'does-not' })).not.to.be.ok();
    });

    it(`validates nonexisting schema if 'missingRefs' set to 'ignore'`
    , function () {
      let ajv = ajvWithOptions({ missingRefs: 'ignore' });
      let test = ajv.compile({ $ref$data: ['', '/a'] });
      test({ a: 'does-not-exist' });
      expect(test.errors || []).to.eql([]);
    });

    it(`uses package's 'missingRefs' if provided`, function () {
      let ajv = ajvWithOptions(
        { missingRefs: 'ignore', schemas: [ { id: 'exists' } ] },
        { missingRefs: true }
      );
      let test = ajv.compile({ $ref$data: ['', '/a'] });
      test({ a: 'exists' });
      expect(test.errors || []).to.eql([]);
      expect(test({ a: 'does-not' })).not.to.be.ok();

      ajv = ajvWithOptions({ missingRefs: true }, { missingRefs: 'ignore' });
      test = ajv.compile({ $ref$data: ['', '/a'] });
      test({ a: 'does-not-exist' });
      expect(test.errors || []).to.eql([]);
    });

    it(`resolves $ref that is absolute path`, function () {
      let ajv = ajvWithOptions({ schemas: [
        { id: '/a/b', extra: { type: 'integer' } }
      ]});
      let test = ajv.compile({ id: '/a/c', $ref$data: ['/a/b#/extra'] });
      test(4);
      expect(test.errors || []).to.eql([]);
      expect(test('s')).not.to.be.ok();
    });

    it(`resolves $ref that is relative path`, function () {
      let ajv = ajvWithOptions({ schemas: [
        { id: '/a/b', extra: { type: 'integer' } }
      ]});
      let test = ajv.compile({ id: '/a/c', $ref$data: ['b#/extra'] });
      test(4);
      expect(test.errors || []).to.eql([]);
      expect(test('s')).not.to.be.ok();
    });

    it(`resolves $ref that is hash frag with named id`, function () {
      let ajv = ajvWithOptions();
      let test = ajv.compile({
        id: 'base', extra: { id: '#x', type: 'integer' },
        $ref$data: ['#x']
      });
      test(4);
      expect(test.errors || []).to.eql([]);
      expect(test('s')).not.to.be.ok();
    });

    it(`resolves $ref that is hash frag with JSON pointer`, function () {
      let ajv = ajvWithOptions();
      let test = ajv.compile({
        id: 'base', extra: { type: 'integer' }, $ref$data: ['#/extra']
      });
      test(4);
      expect(test.errors || []).to.eql([]);
      expect(test('s')).not.to.be.ok();

      test = ajv.compile({
        id: '/complex',
        definitions: {
          b: { properties: { value: { type: 'boolean' } } },
          i: { properties: { value: { type: 'integer' } } }
        },
        items: { $ref$data: ['/complex#/definitions/', '0/type'] },
        type: 'array'
      });
      test([{ type: 'i', value: 4 }, { type: 'b', value: false }]);
      expect(test.errors || []).to.eql([]);
      expect(test([{ type: 'b', value: 5 }])).not.to.be.ok();
    });

    it(`fails to invoke async schema from sync schema`, function () {
      let ajv = ajvWithOptions({ schemas: [
        { id: 'async', $async: true }
      ] });
      let test = ajv.compile({ $ref$data: ['async'] });
      expect(test({})).not.to.be.ok();
    });

    it(`reports all errors from inner schema`, function () {
      let ajv = ajvWithOptions({ allErrors: true, schemas: [
        { id: 'other', items: { maximum: 5 } }
      ] });
      let test = ajv.compile({ $ref$data: ['other'] });
      expect(test([6, 4, 10])).not.to.be.ok;
      expect(test.errors).to.have.lengthOf(2);
    });
  });

  function nestingTests(type) {
    return function () {
      it(`replaces absolute $data reference`, function () {
        let options = {
          $ref: 'nested',
          $ref$data: ['nested']
        };
        let ajv = ajvWithOptions({ schemas: [
          { id: 'a', enum: [4] },
          { id: 'nested', properties: {
            b: { items: { $ref$data: ['', '/a/0/c'] } }
          } }
        ] });
        let test = ajv.compile({
          properties: { a: {
            items: { [type]: options[type] }
          } }
        });
        test({ a: [{ b: [4], c: 'a' }] });
        expect(test.errors || []).to.eql([]);
        expect(test({ a: [{ b: [5], c: 'a' }] })).not.to.be.ok();
      });

      it(`replaces relative $data reference to value`, function () {
        let options = {
          $ref: 'nested',
          $ref$data: ['nested']
        };
        let ajv = ajvWithOptions({ schemas: [
          { id: 'a', enum: [4] },
          { id: 'nested', properties: {
            b: { items: { $ref$data: ['', '2/c'] } }
          } }
        ] });
        let test = ajv.compile({
          properties: { a: {
            items: { [type]: options[type] }
          } }
        });
        ajv.validate('nested', { b: [4], c: 'a' });
        expect(ajv.errors || []).to.eql([]);
        test({ a: [{ b: [4], c: 'a' }] });
        expect(test.errors || []).to.eql([]);
        expect(test({ a: [{ b: [5], c: 'a' }] })).not.to.be.ok();
      });

      it(`replaces relative $data reference to key`, function () {
        let options = {
          $ref: 'nested',
          $ref$data: ['nested']
        };
        let ajv = ajvWithOptions({ schemas: [
          { id: 'b', enum: [4] },
          { id: 'nested', properties: {
            b: { items: { $ref$data: ['', '1#'] } }
          } }
        ] });
        let test = ajv.compile({
          properties: { a: {
            items: { [type]: options[type] }
          } }
        });
        test({ a: [{ b: [4] }] });
        expect(test.errors || []).to.eql([]);
        expect(test({ a: [{ b: [5] }] })).not.to.be.ok();
      });

      it(`resolves $ref relative to absolute path base id`, function () {
        let options = {
          $ref: '/nested/first',
          $ref$data: ['/nested/first']
        };
        let ajv = ajvWithOptions({ schemas: [
          { id: '/nested/next', enum: [4] },
          { id: '/nested/first', $ref$data: ['next'] }
        ] });
        let test = ajv.compile({ [type]: options[type] });
        test(4);
        expect(test.errors || []).to.eql([]);
        expect(test(5)).not.to.be.ok();
      });

      it(`resolves $ref relative to relative path base id`, function () {
        let options = {
          $ref: 'nested/first',
          $ref$data: ['nested/first']
        };
        let ajv = ajvWithOptions({ schemas: [
          { id: '/nested/first', $ref$data: ['next'] },
          { id: '/nested/next', enum: [4] }
        ] });
        let test = ajv.compile({
          id: '/parent', items: { [type]: options[type] }
        });
        test([4]);
        expect(test.errors || []).to.eql([]);
        expect(test([5])).not.to.be.ok();
      });

      let qual = type == '$ref' ? `(with 'inlineRefs' false)` : 'base id';

      it(`resolves $ref relative to hash frag ${qual}`, function () {
        let options = {
          $ref: 'nested/first#/definitions/next',
          $ref$data: ['nested/first#/definitions/next']
        };
        let schemas = [
          { id: '/nested/first', definitions: {
            next: { $ref: 'up/next#/a' }
          } },
          { id: '/nested/up/next', a: { $ref$data: ['more'] } },
          { id: '/nested/up/more', enum: [4] }
        ];
        let ajv = ajvWithOptions(
          type == '$ref' ? { inlineRefs: false, schemas } : { schemas }
        );
        let test = ajv.compile({
          id: '/parent', items: { [type]: options[type] }
        });
        test([4]);
        expect(test.errors || []).to.eql([]);
        expect(test([5])).not.to.be.ok();
      });

      it(`resolves hash $ref relative to hash frag ${qual}`, function () {
        let options = {
          $ref: 'nested#/definitions/first',
          $ref$data: ['nested#/definitions/first']
        };
        let schemas = [
          { id: '/nested', definitions: {
            first: { $ref$data: ['#/definitions/next'] },
            next: { enum: [4] }
          } }
        ];
        let ajv = ajvWithOptions(
          type == '$ref' ? { inlineRefs: false, schemas } : { schemas }
        );
        let test = ajv.compile({
          id: '/parent', items: { [type]: options[type] }
        });
        test([4]);
        expect(test.errors || []).to.eql([]);
        expect(test([5])).not.to.be.ok();
      });
    };
  }

  context(`nested within $ref`, nestingTests('$ref'));

  context(`nested within $ref$data`, nestingTests('$ref$data'));

  context(`does not break composite schemas`, function () {
    it(`when invoked in anyOf`, function () {
      let ajv = ajvWithOptions({ schemas: [
        { id: 'invoked', type: 'integer' }
      ] });
      let test = ajv.compile({ anyOf: [
        { $ref$data: ['invoked'] },
        { type: 'string' }
      ] });
      test('s');
      expect(test.errors || []).to.eql([]);
      expect(test(true)).not.to.be.ok();
    });

    it(`when invoked in oneOf`, function () {
      let ajv = ajvWithOptions({ schemas: [
        { id: 'invoked', type: 'number' }
      ] });
      let test = ajv.compile({ oneOf: [
        { type: 'integer' },
        { $ref$data: ['invoked'] },
        { type: 'string' }
      ] });
      expect(test(4)).not.to.be.ok();
      test(3.5);
      expect(test.errors || []).to.eql([]);
      test('s');
      expect(test.errors || []).to.eql([]);
    });

    it(`when invoked in not`, function () {
      let ajv = ajvWithOptions({ schemas: [
        { id: 'invoked', type: 'integer' }
      ] });
      let test = ajv.compile({ not: { $ref$data: ['invoked'] } });
      expect(test(4)).not.to.be.ok();
      test('s');
      expect(test.errors || []).to.eql([]);
    });

    it(`when invoked nested within alternative`, function () {
      let ajv = ajvWithOptions({ schemas: [
        { id: 'invoked', type: 'integer' }
      ] });
      let test = ajv.compile({ anyOf: [
        { items: { $ref$data: ['invoked'] } },
        { type: 'string' }
      ] });
      test([4]);
      expect(test.errors || []).to.eql([]);
      test('s');
      expect(test.errors || []).to.eql([]);
      expect(test(['s'])).not.to.be.ok();
    });
  });

  it(`accepts $id in ajv 5 and higher`, function () {
    let ajv = ajvWithOptions();
    if (!ajv.RULES.keywords.const) this.skip(); // not ajv 5
    ajv.addSchema({ $id: 'invoked', type: 'integer' });
    let test = ajv.compile({ $ref$data: ['invoked'] });
    test(4);
    expect(test.errors || []).to.eql([]);
    expect(test('s')).not.to.be.ok();
  });
});


describe(`async$ref$data`, function () {
  // this block tests only failure points specific to async validation and
  // assumes the compiled validator is the same for sync and async cases

  it(`has same compile function as '$ref$data'`, function () {
    // check the compiled validator wasn't inadvertently changed
    let ajv = ajvWithOptions();
    let custom = ajv.RULES.custom;
    let $ref$data = custom.$ref$data.definition.compile;
    let async$ref$data = custom.async$ref$data.definition.compile;
    expect($ref$data).equal(async$ref$data);
  });

  it(`rejects '$ref$data' in async schema`, function () {
    let ajv = ajvWithOptions();
    let schema = {
      $async: true,
      items: { $ref$data: ['b'] }
    };
    expect(() => ajv.compile(schema)).to.throw();
  });

  it(`rejects sibling '$ref$data'`, function () {
    let ajv = ajvWithOptions();
    let schema = {
      $async: true,
      items: { async$ref$data: ['a'], $ref$data: ['b'] }
    };
    expect(() => ajv.compile(schema)).to.throw();
  });

  it(`rejects sibling keywords if 'extendRefs' set to 'fail'`, function () {
    let ajv = ajvWithOptions({ extendRefs: 'fail' });
    let schema = {
      $async: true,
      items: { async$ref$data: ['a'], maximum: 4 }
    };
    expect(() => ajv.compile(schema)).to.throw();
  });

  it(`rejects nonexisting schema if 'missingRefs' not set to 'ignore'`
  , co.wrap(function* () {
    let ajv = ajvWithOptions({ missingRefs: true, schemas: [
      { id: 'exists' }
    ] });
    let test = ajv.compile({ $async: true, async$ref$data: ['', '/a'] });
    yield expect(test({ a: 'exists' })).to.eventually.be.fulfilled();
    yield expect(test({ a: 'does-not' })).to.eventually.be.rejected();
  }));

  it(`validates nonexisting schema if 'missingRefs' set to 'ignore'`
  , co.wrap(function* () {
    let ajv = ajvWithOptions({ missingRefs: 'ignore' });
    let test = ajv.compile({ $async: true, async$ref$data: ['', '/a'] });
    yield expect(test({ a: 'does-not-exist' }))
      .to.eventually.be.fulfilled();
  }));

  it(`checks that $data references point to valid data (multiple errors)`
  , co.wrap(function* () {
    let ajv = ajvWithOptions({ allErrors: true });
    let test = ajv.compile({
      $async: true, properties: { target: { async$ref$data: [
        'any', '/a/0', 'any', '1/b', 'any', '0/c'
      ] } }
    });
    let result = test({ a: [true], b: null, c: 4, target: 4 });
    yield expect(result).to.eventually.be.rejected();
    let errors = yield result.catch(e => e.errors);
    errors.forEach((err, idx) => {
      expect(err)
        .to.have.nested.property('params.dataPath', `[${2 * idx + 1}]`);
      expect(err).to.have.nested.property('dataPath', '.target');
    });
  }));

  it(`correctly invokes sync schema`, co.wrap(function* () {
    let ajv = ajvWithOptions({ schemas: [
      { id: 'sync', type: 'integer' }
    ] });
    let test = ajv.compile({ $async: true, async$ref$data: ['sync'] });
    yield expect(test(4)).to.eventually.be.fulfilled();
    yield expect(test('s')).to.eventually.be.rejected();
  }));

  it(`reports all errors from sync schema`, co.wrap(function* () {
    let ajv = ajvWithOptions({ allErrors: true, schemas: [
      { id: 'sync', items: { type: 'integer' } }
    ] });
    let test = ajv.compile({ $async: true, async$ref$data: ['sync'] });
    let result = test([4, 's', true]);
    yield expect(result).to.eventually.be.rejected();
    yield result.catch(err => expect(err.errors).to.have.lengthOf(2));
  }));

  it(`correctly invokes async schema`, co.wrap(function* () {
    let ajv = ajvWithOptions({ schemas: [
      { $async: true, id: 'async', type: 'integer' }
    ] });
    let test = ajv.compile({ $async: true, async$ref$data: ['async'] });
    yield expect(test(4)).to.eventually.be.fulfilled();
    yield expect(test('s')).to.eventually.be.rejected();
  }));

  it(`reports all errors from async schema`, co.wrap(function* () {
    let ajv = ajvWithOptions({ allErrors: true, schemas: [
      { $async: true, id: 'async', items: { type: 'integer' } }
    ] });
    let test = ajv.compile({ $async: true, async$ref$data: ['async'] });
    let result = test([4, 's', true]);
    yield expect(result).to.eventually.be.rejected();
    yield result.catch(err => expect(err.errors).to.have.lengthOf(2));
  }));
});
