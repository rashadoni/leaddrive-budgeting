"use client"

import { useEffect } from "react"
import { useWallpaper } from "@/hooks/use-wallpaper"
import { VideoBackground } from "@/components/video-background"

/**
 * Renders wallpaper ONLY on dashboard page.
 * Sets data-wallpaper on mount.
 * On unmount (navigating away): removes data-wallpaper but forces dark mode
 * so the transition is smooth (dark with video → dark without video).
 */
export function DashboardWallpaper() {
  const { wallpaperDef, isWallpaperActive } = useWallpaper()

  useEffect(() => {
    if (isWallpaperActive && wallpaperDef) {
      document.documentElement.setAttribute("data-wallpaper", wallpaperDef.id)
    }
    return () => {
      document.documentElement.removeAttribute("data-wallpaper")
    }
  }, [isWallpaperActive, wallpaperDef])

  if (!isWallpaperActive) return null

  return <VideoBackground />
}
