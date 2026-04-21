"use client"

import { useEffect, useRef } from "react"
import { useWallpaper } from "@/hooks/use-wallpaper"

export function VideoBackground() {
  const { wallpaperDef, isWallpaperActive } = useWallpaper()
  const videoRef = useRef<HTMLVideoElement>(null)

  // Fix React muted prop bug + autoplay + visibility handling
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // React doesn't render muted attribute correctly — set it manually
    video.muted = true
    video.play().catch(() => {})

    const handleVisibility = () => {
      if (document.hidden) {
        video.pause()
      } else {
        video.muted = true
        video.play().catch(() => {})
      }
    }

    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [wallpaperDef])

  if (!isWallpaperActive || !wallpaperDef) return null

  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        src={wallpaperDef.src}
        className="h-full w-full object-cover"
        key={wallpaperDef.id}
      />
{/* No scrim — maximum brightness */}
    </div>
  )
}
