/**
 * Adapter Registry
 *
 * Manages schema adapters for different accounting software.
 * Provides runtime selection based on softwareId from settings.
 */

import type { SchemaAdapter } from './schemaAdapter'
import { SepidarAdapter } from './adapters/sepidarAdapter'

class AdapterRegistry {
  private adapters: Map<string, SchemaAdapter> = new Map()
  private currentAdapter: SchemaAdapter | null = null

  registerAdapter(adapter: SchemaAdapter): void {
    this.adapters.set(adapter.softwareId, adapter)
  }

  getAdapter(softwareId: string): SchemaAdapter {
    const adapter = this.adapters.get(softwareId)
    if (!adapter) {
      throw new Error(`No adapter registered for software: ${softwareId}`)
    }
    return adapter
  }

  setCurrentAdapter(softwareId: string): void {
    this.currentAdapter = this.getAdapter(softwareId)
  }

  getCurrentAdapter(): SchemaAdapter {
    if (!this.currentAdapter) {
      throw new Error('No current adapter set. Call setCurrentAdapter first.')
    }
    return this.currentAdapter
  }

  hasAdapter(softwareId: string): boolean {
    return this.adapters.has(softwareId)
  }

  getRegisteredSoftwareIds(): string[] {
    return Array.from(this.adapters.keys())
  }
}

// Singleton instance
export const adapterRegistry = new AdapterRegistry()

// Register built-in adapters
adapterRegistry.registerAdapter(new SepidarAdapter())

// Export for testing
export { AdapterRegistry }
