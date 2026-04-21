"use client"

import { useContext } from "react"
import { WallpaperContext } from "@/contexts/wallpaper-context"

export function useWallpaper() {
  return useContext(WallpaperContext)
}
