import type { ApexClassInput } from './apexTypes.js';

/** `@isTest`, optionally with arguments, then the class declaration's own modifiers. */
const TEST_DECLARATION =
  /@istest\b(?:\s*\([^)]*\))?\s+(?:(?:public|private|global|virtual|abstract|with|without|inherited|sharing)\s+)*class\b/i;

interface TableDeclaration {
  annotations?: Array<{ name?: string | null }> | null;
  modifiers?: string[] | null;
}

/**
 * Whether the platform marks this class as a test. The SymbolTable's class-level `IsTest`
 * annotation or `testMethod` modifier decides; without a SymbolTable, the body's class declaration
 * does. The name is never consulted: `...Test` is a convention, and a class can be a test without
 * it or carry it without being one. OBJECT_ROLES_SPEC 2.1.
 */
export function isTestClass(cls: ApexClassInput): boolean {
  const decl = cls.symbolTable?.tableDeclaration as TableDeclaration | undefined;
  if (decl) {
    if (decl.annotations?.some((a) => a.name?.toLowerCase() === 'istest')) return true;
    if (decl.modifiers?.some((m) => m.toLowerCase() === 'testmethod')) return true;
    return false;
  }
  return cls.body !== null && TEST_DECLARATION.test(cls.body);
}
