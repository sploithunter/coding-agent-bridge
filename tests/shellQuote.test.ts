import { describe, it, expect } from 'vitest'
import { shellQuote, validateFlagKey, buildSafeFlag } from '../src/utils/shellQuote.js'

describe('shellQuote', () => {
  it('should wrap simple values in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'")
  })

  it('should escape embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })

  it('should neutralize semicolons', () => {
    expect(shellQuote('x; touch /tmp/rce')).toBe("'x; touch /tmp/rce'")
  })

  it('should neutralize pipe characters', () => {
    expect(shellQuote('x | cat /etc/passwd')).toBe("'x | cat /etc/passwd'")
  })

  it('should neutralize backticks', () => {
    expect(shellQuote('x`whoami`')).toBe("'x`whoami`'")
  })

  it('should neutralize dollar signs and subshells', () => {
    expect(shellQuote('x$(id)')).toBe("'x$(id)'")
  })

  it('should neutralize ampersands', () => {
    expect(shellQuote('x && rm -rf /')).toBe("'x && rm -rf /'")
  })

  it('should neutralize newlines', () => {
    expect(shellQuote('x\nmalicious')).toBe("'x\nmalicious'")
  })

  it('should handle empty strings', () => {
    expect(shellQuote('')).toBe("''")
  })
})

describe('validateFlagKey', () => {
  it('should accept simple alphanumeric keys', () => {
    expect(() => validateFlagKey('model')).not.toThrow()
    expect(() => validateFlagKey('verbose')).not.toThrow()
  })

  it('should accept hyphenated keys', () => {
    expect(() => validateFlagKey('full-auto')).not.toThrow()
    expect(() => validateFlagKey('dangerously-skip-permissions')).not.toThrow()
  })

  it('should reject empty keys', () => {
    expect(() => validateFlagKey('')).toThrow(/Invalid flag key/)
  })

  it('should reject keys with semicolons', () => {
    expect(() => validateFlagKey('model;rm')).toThrow(/Invalid flag key/)
  })

  it('should reject keys with spaces', () => {
    expect(() => validateFlagKey('model name')).toThrow(/Invalid flag key/)
  })

  it('should reject keys with equals signs', () => {
    expect(() => validateFlagKey('model=bad')).toThrow(/Invalid flag key/)
  })

  it('should reject keys starting with hyphens', () => {
    expect(() => validateFlagKey('-model')).toThrow(/Invalid flag key/)
  })

  it('should reject keys ending with hyphens', () => {
    expect(() => validateFlagKey('model-')).toThrow(/Invalid flag key/)
  })

  it('should reject keys with shell metacharacters', () => {
    expect(() => validateFlagKey('key$(id)')).toThrow(/Invalid flag key/)
    expect(() => validateFlagKey('key`cmd`')).toThrow(/Invalid flag key/)
    expect(() => validateFlagKey('key|pipe')).toThrow(/Invalid flag key/)
  })
})

describe('buildSafeFlag', () => {
  it('should return null for false values', () => {
    expect(buildSafeFlag('verbose', false)).toBeNull()
  })

  it('should return boolean flag for true values', () => {
    expect(buildSafeFlag('verbose', true)).toBe('--verbose')
  })

  it('should shell-quote string values', () => {
    expect(buildSafeFlag('model', 'gpt-4')).toBe("--model='gpt-4'")
  })

  it('should prevent command injection in values', () => {
    const flag = buildSafeFlag('model', 'x; touch /tmp/bridge-rce')
    expect(flag).toBe("--model='x; touch /tmp/bridge-rce'")
    // The value is safely quoted - the semicolon won't be interpreted
    expect(flag).not.toMatch(/--model=x;/)
  })

  it('should throw on invalid flag keys', () => {
    expect(() => buildSafeFlag('bad;key', 'value')).toThrow(/Invalid flag key/)
  })
})
