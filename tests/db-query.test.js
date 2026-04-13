import { describe, it, expect } from 'vitest';
import { parseJsonArg } from '../src/commands/db-query.js';

describe('parseJsonArg', () => {
  it('parses valid JSON as-is', () => {
    expect(parseJsonArg('{"Key":"Value","Count":5}')).toEqual({ Key: 'Value', Count: 5 });
  });

  it('returns empty object for empty/null input', () => {
    expect(parseJsonArg('')).toEqual({});
    expect(parseJsonArg(undefined)).toEqual({});
  });

  // Windows cmd.exe strips double-quotes, resulting in unquoted keys/values.

  it('recovers unquoted keys and string values (cmd.exe stripping)', () => {
    expect(parseJsonArg('{Status:Active,MaxRecords:10}')).toEqual({ Status: 'Active', MaxRecords: 10 });
  });

  it('recovers empty string values', () => {
    expect(parseJsonArg('{SearchKeyword:,SortBy:NameAsc}')).toEqual({ SearchKeyword: '', SortBy: 'NameAsc' });
  });

  it('recovers comma-separated values inside a param (e.g. CategoryIds)', () => {
    const result = parseJsonArg('{SearchKeyword:,CategoryIds:1,2,SortBy:NameAsc,MaxRecords:5,Offset:0}');
    expect(result).toEqual({
      SearchKeyword: '',
      CategoryIds: '1,2',
      SortBy: 'NameAsc',
      MaxRecords: 5,
      Offset: 0,
    });
  });

  it('preserves booleans and null without quoting', () => {
    expect(parseJsonArg('{Active:true,Deleted:false,Ref:null}')).toEqual({
      Active: true,
      Deleted: false,
      Ref: null,
    });
  });

  it('throws a helpful error for truly unparseable input', () => {
    expect(() => parseJsonArg('not json at all %%!')).toThrow('Could not parse parameters as JSON');
  });
});
