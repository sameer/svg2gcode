import { useEffect, useState } from 'react'

export function useImageAsset(src: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => setImage(img)
    img.src = src
    return () => {
      img.onload = null
    }
  }, [src])

  return image
}
