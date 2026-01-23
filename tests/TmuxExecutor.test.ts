import { describe, it, expect } from 'vitest'
import {
  validateSessionName,
  validatePath,
  validatePaneId,
  TmuxExecutor,
} from '../src/TmuxExecutor.js'

describe('TmuxExecutor Validation', () => {
  describe('validateSessionName', () => {
    it('should accept valid session names', () => {
      expect(() => validateSessionName('my-session')).not.toThrow()
      expect(() => validateSessionName('session_123')).not.toThrow()
      expect(() => validateSessionName('MySession')).not.toThrow()
      expect(() => validateSessionName('a1b2c3')).not.toThrow()
    })

    it('should reject empty session names', () => {
      expect(() => validateSessionName('')).toThrow(/invalid session name/i)
    })

    it('should reject session names with spaces', () => {
      expect(() => validateSessionName('my session')).toThrow(/invalid session name/i)
    })

    it('should reject session names with special characters', () => {
      expect(() => validateSessionName('my;session')).toThrow(/invalid session name/i)
      expect(() => validateSessionName('my&session')).toThrow(/invalid session name/i)
      expect(() => validateSessionName('my|session')).toThrow(/invalid session name/i)
      expect(() => validateSessionName('my$session')).toThrow(/invalid session name/i)
      expect(() => validateSessionName('my`session')).toThrow(/invalid session name/i)
      expect(() => validateSessionName("my'session")).toThrow(/invalid session name/i)
      expect(() => validateSessionName('my"session')).toThrow(/invalid session name/i)
    })

    it('should reject session names with dots', () => {
      expect(() => validateSessionName('my.session')).toThrow(/invalid session name/i)
    })
  })

  describe('validatePath', () => {
    it('should accept valid paths', () => {
      expect(() => validatePath('/home/user/project')).not.toThrow()
      expect(() => validatePath('/Users/test/Documents')).not.toThrow()
      expect(() => validatePath('/tmp')).not.toThrow()
      expect(() => validatePath('/path/with-dash/and_underscore')).not.toThrow()
    })

    it('should reject empty paths', () => {
      expect(() => validatePath('')).toThrow(/cannot be empty/i)
    })

    it('should reject paths with dangerous characters', () => {
      expect(() => validatePath('/path;rm -rf /')).toThrow(/dangerous/i)
      expect(() => validatePath('/path && ls')).toThrow(/dangerous/i)
      expect(() => validatePath('/path | cat')).toThrow(/dangerous/i)
      expect(() => validatePath('/path`whoami`')).toThrow(/dangerous/i)
      expect(() => validatePath('/path$(id)')).toThrow(/dangerous/i)
      expect(() => validatePath("/path'test")).toThrow(/dangerous/i)
      expect(() => validatePath('/path"test')).toThrow(/dangerous/i)
    })

    it('should reject paths with newlines', () => {
      expect(() => validatePath('/path\nwith\nnewlines')).toThrow(/dangerous/i)
    })
  })

  describe('validatePaneId', () => {
    it('should accept valid pane IDs', () => {
      expect(() => validatePaneId('%0')).not.toThrow()
      expect(() => validatePaneId('%1')).not.toThrow()
      expect(() => validatePaneId('%99')).not.toThrow()
      expect(() => validatePaneId('%123')).not.toThrow()
    })

    it('should reject empty pane IDs', () => {
      expect(() => validatePaneId('')).toThrow(/invalid pane id/i)
    })

    it('should reject pane IDs without %', () => {
      expect(() => validatePaneId('0')).toThrow(/invalid pane id/i)
      expect(() => validatePaneId('pane0')).toThrow(/invalid pane id/i)
    })

    it('should reject pane IDs with non-numeric suffix', () => {
      expect(() => validatePaneId('%abc')).toThrow(/invalid pane id/i)
      expect(() => validatePaneId('%0a')).toThrow(/invalid pane id/i)
    })

    it('should reject injection attempts', () => {
      expect(() => validatePaneId('%0;rm -rf /')).toThrow(/invalid pane id/i)
      expect(() => validatePaneId('%0 && ls')).toThrow(/invalid pane id/i)
    })
  })
})

describe('TmuxExecutor', () => {
  it('should create an executor instance', () => {
    const executor = new TmuxExecutor()
    expect(executor).toBeInstanceOf(TmuxExecutor)
  })

  it('should accept debug option', () => {
    const logs: string[] = []
    const executor = new TmuxExecutor({
      debug: true,
      logger: (msg) => logs.push(msg),
    })
    expect(executor).toBeInstanceOf(TmuxExecutor)
  })
})
