import { PersonNode, GraphNode } from '../types/graph'

/**
 * Cache for preloaded avatar images.
 * Ensures smooth rendering by loading images before the graph displays.
 */
class AvatarCache {
  private cache = new Map<string, HTMLImageElement>()
  private loading = new Set<string>()
  private failed = new Set<string>()

  /**
   * Preload all avatar images for person nodes.
   */
  async preload(nodes: GraphNode[]): Promise<void> {
    const personNodes = nodes.filter(
      (n): n is PersonNode => n.type === 'person'
    )

    const loadPromises = personNodes
      .filter(node => this.getAvatarUrl(node))
      .map(node => this.loadImage(node.id, this.getAvatarUrl(node)!))

    await Promise.all(loadPromises)
  }

  /**
   * Get the best available avatar URL for a node.
   * Prefers local path (no CORS), falls back to remote URL.
   */
  private getAvatarUrl(node: PersonNode): string | null {
    return node.local_avatar_path || node.profile_image_url
  }

  /**
   * Load a single image into the cache.
   */
  private loadImage(id: string, url: string): Promise<void> {
    return new Promise((resolve) => {
      if (this.cache.has(id) || this.loading.has(id)) {
        resolve()
        return
      }

      this.loading.add(id)

      const img = new Image()
      img.crossOrigin = 'anonymous'

      img.onload = () => {
        this.cache.set(id, img)
        this.loading.delete(id)
        resolve()
      }

      img.onerror = () => {
        this.loading.delete(id)
        this.failed.add(id)
        resolve() // Resolve anyway - we'll use placeholder
      }

      img.src = url
    })
  }

  /**
   * Get cached image for a node ID.
   */
  get(id: string): HTMLImageElement | undefined {
    return this.cache.get(id)
  }

  /**
   * Check if an image failed to load.
   */
  hasFailed(id: string): boolean {
    return this.failed.has(id)
  }

  /**
   * Check if image is still loading.
   */
  isLoading(id: string): boolean {
    return this.loading.has(id)
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear()
    this.loading.clear()
    this.failed.clear()
  }
}

// Singleton instance
export const avatarCache = new AvatarCache()

/**
 * Draw a circular avatar on a canvas context.
 */
export function drawCircularAvatar(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  radius: number,
  borderColor: string,
  borderWidth: number
): void {
  ctx.save()

  // Create circular clip
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()

  // Draw image centered and scaled to fit
  ctx.drawImage(
    img,
    x - radius,
    y - radius,
    radius * 2,
    radius * 2
  )

  ctx.restore()

  // Draw border
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.strokeStyle = borderColor
  ctx.lineWidth = borderWidth
  ctx.stroke()
}

/**
 * Draw a placeholder circle for nodes without avatars.
 */
export function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fillColor: string,
  borderColor: string,
  borderWidth: number
): void {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.strokeStyle = borderColor
  ctx.lineWidth = borderWidth
  ctx.stroke()
}
