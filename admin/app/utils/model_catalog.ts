export class ModelCapabilityCache {
  private values = new Map<string, boolean>()

  get(modelName: string): boolean | undefined {
    return this.values.get(modelName)
  }

  recordSuccessfulLookup(modelName: string, capable: boolean): void {
    this.values.set(modelName, capable)
  }
}

export function hasUsableRecommendedModels<T>(models: T[] | null): models is T[] {
  return Array.isArray(models) && models.length > 0
}

export function isUsableModelCatalogCache(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}
