import type { AppSettings, DiscoveredAdapterEntry, SoftwareMode } from '../../shared/contracts'
import type { SchemaAdapter } from './financialEngine/schemaAdapter'

export function adapterKey(server: string, database: string): string {
  const cleanServer = server.replace(/[^a-zA-Z0-9._-]/g, '')
  const cleanDb = database.replace(/[^a-zA-Z0-9._-]/g, '')
  return `auto-${cleanServer}-${cleanDb}`
}

export interface AdapterStore {
  getAdapter(key: string): DiscoveredAdapterEntry | null
  getConfirmedAdapter(key: string): DiscoveredAdapterEntry | null
  saveAdapter(key: string, entry: DiscoveredAdapterEntry): void
  confirmAdapter(key: string): void
  updateAdapterMapping(key: string, adapter: SchemaAdapter): void
  deleteAdapter(key: string): void
  listAdapters(): Array<{ key: string; entry: DiscoveredAdapterEntry }>
  getAdapterForConnection(server: string, database: string): DiscoveredAdapterEntry | null
  getConfirmedAdapterForConnection(server: string, database: string): DiscoveredAdapterEntry | null
}

export function createAdapterStore(
  getSettings: () => AppSettings,
  saveSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
): AdapterStore {
  function getAdapters(): Record<string, DiscoveredAdapterEntry> {
    return getSettings().discoveredAdapters ?? {}
  }

  async function patchAdapters(adapters: Record<string, DiscoveredAdapterEntry>): Promise<void> {
    await saveSettings({ discoveredAdapters: adapters })
  }

  return {
    getAdapter(key: string): DiscoveredAdapterEntry | null {
      const adapters = getAdapters()
      return adapters[key] ?? null
    },

    getConfirmedAdapter(key: string): DiscoveredAdapterEntry | null {
      const adapters = getAdapters()
      const entry = adapters[key]
      if (entry && entry.confirmed) {
        return entry
      }
      return null
    },

    saveAdapter(key: string, entry: DiscoveredAdapterEntry): void {
      const adapters = getAdapters()
      void patchAdapters({ ...adapters, [key]: entry })
    },

    confirmAdapter(key: string): void {
      const adapters = getAdapters()
      const entry = adapters[key]
      if (entry) {
        void patchAdapters({ ...adapters, [key]: { ...entry, confirmed: true } })
      }
    },

    updateAdapterMapping(key: string, adapter: SchemaAdapter): void {
      const adapters = getAdapters()
      const entry = adapters[key]
      if (entry) {
        void patchAdapters({
          ...adapters,
          [key]: { ...entry, adapter, confirmed: true },
        })
      }
    },

    deleteAdapter(key: string): void {
      const adapters = getAdapters()
      const rest = { ...adapters }
      delete rest[key]
      void patchAdapters(rest)
    },

    listAdapters(): Array<{ key: string; entry: DiscoveredAdapterEntry }> {
      const adapters = getAdapters()
      return Object.entries(adapters).map(([key, entry]) => ({ key, entry }))
    },

    getAdapterForConnection(server: string, database: string): DiscoveredAdapterEntry | null {
      return this.getAdapter(adapterKey(server, database))
    },

    getConfirmedAdapterForConnection(server: string, database: string): DiscoveredAdapterEntry | null {
      return this.getConfirmedAdapter(adapterKey(server, database))
    },
  }
}

export function setSoftwareMode(
  saveSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>,
  mode: SoftwareMode
): void {
  void saveSettings({ softwareMode: mode })
}
