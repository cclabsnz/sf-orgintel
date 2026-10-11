import { describe, it, expect } from '@jest/globals';
import { isTestClass } from '../../../src/map/apex/testClass.js';
import type { ApexClassInput } from '../../../src/map/apex/apexTypes.js';

/**
 * A test class inserts fixture data for many objects at once, so analysing it as automation adds
 * couplings that do not exist in the running org. On a real Health Cloud sandbox 357 of 578 Apex
 * classes with object references were tests, and every create of one reference object came from
 * them. OBJECT_ROLES_SPEC 2.1. The platform marks a test with the IsTest annotation; the class
 * name is a convention and is never used.
 */
const cls = (over: Partial<ApexClassInput>): ApexClassInput => ({
  name: 'Anything',
  namespace: null,
  body: null,
  symbolTable: null,
  ...over,
});

describe('isTestClass', () => {
  it('recognises the IsTest annotation in the SymbolTable', () => {
    expect(isTestClass(cls({ symbolTable: { tableDeclaration: { annotations: [{ name: 'IsTest' }], modifiers: ['private'] } } }))).toBe(true);
  });

  it('recognises the testMethod modifier in the SymbolTable', () => {
    expect(isTestClass(cls({ symbolTable: { tableDeclaration: { annotations: [], modifiers: ['private', 'testMethod'] } } }))).toBe(true);
  });

  it('falls back to the class declaration in the body when there is no SymbolTable', () => {
    expect(isTestClass(cls({ body: '@isTest\nprivate class Fixtures {\n}' }))).toBe(true);
    expect(isTestClass(cls({ body: '@IsTest(SeeAllData=false)\npublic with sharing class Fixtures {}' }))).toBe(true);
  });

  it('does not judge by name', () => {
    expect(isTestClass(cls({ name: 'AccountServiceTest', body: 'public class AccountServiceTest {}' }))).toBe(false);
    expect(isTestClass(cls({ name: 'Plain', symbolTable: { tableDeclaration: { annotations: [{ name: 'IsTest' }] } } }))).toBe(true);
  });

  it('is false for production code, and for a class with nothing to read', () => {
    expect(isTestClass(cls({ body: 'public class Svc { void run() {} }' }))).toBe(false);
    expect(isTestClass(cls({}))).toBe(false);
  });
});
