/**
 * Unit tests for HookInstaller
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HookInstaller } from '../src/HookInstaller.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'

describe('HookInstaller', () => {
  let installer: HookInstaller
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `hook-installer-test-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })

    installer = new HookInstaller({
      dataDir: testDir,
      debug: false,
    })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('constructor', () => {
    it('should create installer with default config', () => {
      const inst = new HookInstaller()
      expect(inst).toBeInstanceOf(HookInstaller)
    })

    it('should create installer with custom config', () => {
      const inst = new HookInstaller({
        dataDir: '/custom/path',
        debug: true,
      })
      expect(inst).toBeInstanceOf(HookInstaller)
    })
  })

  describe('checkDependencies', () => {
    it('should check for tmux', async () => {
      const deps = await installer.checkDependencies()
      const tmux = deps.find((d) => d.name === 'tmux')

      expect(tmux).toBeDefined()
      expect(typeof tmux?.available).toBe('boolean')
    })

    it('should check for jq', async () => {
      const deps = await installer.checkDependencies()
      const jq = deps.find((d) => d.name === 'jq')

      expect(jq).toBeDefined()
      expect(typeof jq?.available).toBe('boolean')
    })

    it('should check for curl', async () => {
      const deps = await installer.checkDependencies()
      const curl = deps.find((d) => d.name === 'curl')

      expect(curl).toBeDefined()
      expect(typeof curl?.available).toBe('boolean')
    })
  })

  describe('getHookScriptPath', () => {
    it('should return hook script path', () => {
      const path = installer.getHookScriptPath()
      expect(path).toBe(join(testDir, 'hooks', 'coding-agent-hook.sh'))
    })
  })

  describe('getEventsFilePath', () => {
    it('should return events file path', () => {
      const path = installer.getEventsFilePath()
      expect(path).toBe(join(testDir, 'data', 'events.jsonl'))
    })
  })

  describe('installAll', () => {
    it('should create hook script', async () => {
      await installer.installAll()

      const hookPath = installer.getHookScriptPath()
      expect(existsSync(hookPath)).toBe(true)

      const content = await readFile(hookPath, 'utf8')
      expect(content).toContain('#!/bin/bash')
      expect(content).toContain('coding-agent-hook')
    })

    it('should create data directory', async () => {
      await installer.installAll()

      const dataDir = join(testDir, 'data')
      expect(existsSync(dataDir)).toBe(true)
    })

    it('should return results for each agent', async () => {
      const results = await installer.installAll()

      // Should have results for claude and codex
      expect(results.length).toBeGreaterThanOrEqual(2)
      expect(results.some((r) => r.agent === 'claude')).toBe(true)
      expect(results.some((r) => r.agent === 'codex')).toBe(true)
    })
  })

  describe('install (single agent)', () => {
    it('should install hooks for claude', async () => {
      const result = await installer.install('claude')

      expect(result.agent).toBe('claude')
      // Might succeed or fail depending on environment
      expect(typeof result.success).toBe('boolean')
      expect(typeof result.message).toBe('string')
    })

    it('should return error for unknown agent', async () => {
      const result = await installer.install('unknown' as any)

      expect(result.success).toBe(false)
      expect(result.message).toContain('Unknown agent')
    })
  })

  describe('uninstall', () => {
    it('should uninstall hooks for specific agent', async () => {
      const result = await installer.uninstall('claude')

      expect(result.agent).toBe('claude')
      expect(typeof result.success).toBe('boolean')
    })

    it('should return error for unknown agent', async () => {
      const result = await installer.uninstall('unknown' as any)

      expect(result.success).toBe(false)
    })
  })

  describe('uninstallAll', () => {
    it('should return results for each agent', async () => {
      const results = await installer.uninstallAll()

      expect(results.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('getStatus', () => {
    it('should return status for all agents', async () => {
      const status = await installer.getStatus()

      expect(status.length).toBeGreaterThanOrEqual(2)

      for (const s of status) {
        expect(s.agent).toBeDefined()
        expect(typeof s.installed).toBe('boolean')
        expect(typeof s.settingsPath).toBe('string')
        expect(typeof s.settingsExists).toBe('boolean')
      }
    })

    it('should show not installed when hook script missing', async () => {
      const status = await installer.getStatus()

      // Before setup, nothing should be installed
      for (const s of status) {
        expect(s.installed).toBe(false)
      }
    })
  })
})
