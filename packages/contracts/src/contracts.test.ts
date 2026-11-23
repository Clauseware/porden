
import { expect, test } from 'bun:test';
import { ActionArguments, DamageData, Fields, Origin, canonicalize } from './index';
test('case data is strict and optional address is omitted without fabrication', () => {
  const data = DamageData.parse({orderReference:'DEMO-1042',damageDescription:'Damaged parcel'});
  expect(Object.keys(data)).toEqual(['orderReference','damageDescription']);
  expect(() => DamageData.parse({...data, email:'private@example.com'})).toThrow();
  expect(() => Fields.parse(['orderReference','orderReference'])).toThrow();
  expect(() => ActionArguments.parse(data)).toThrow();
});
test('origins are exact and canonicalization recursively sorts keys', () => {
  expect(() => Origin.parse('https://courier.example/path')).toThrow();
  expect(() => Origin.parse('http://courier.example')).toThrow();
  expect(canonicalize({z:[{b:2,a:1}],a:true})).toBe('{"a":true,"z":[{"a":1,"b":2}]}');
  expect(() => canonicalize({a:undefined})).toThrow();
});
