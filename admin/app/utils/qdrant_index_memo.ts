/** Tracks collections whose existing payload indexes were verified this process. */
export class QdrantIndexMemo {
  private verified = new Set<string>()

  has(collectionName: string): boolean {
    return this.verified.has(collectionName)
  }

  markVerified(collectionName: string): void {
    this.verified.add(collectionName)
  }

  invalidate(collectionName: string): void {
    this.verified.delete(collectionName)
  }

  reset(): void {
    this.verified.clear()
  }
}
