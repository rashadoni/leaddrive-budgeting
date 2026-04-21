"use client"

import { createContext, useCallback, useEffect, useState, type ReactNode } from "react"

export interface WallpaperDef {
  id: string
  label: string
  labelRu: string
  type: "video"
  src: string
}

export const WALLPAPERS: WallpaperDef[] = [
  {
    id: "alpine",
    label: "Alpine Mountains",
    labelRu: "Альпийские горы",
    type: "video",
    src: "/wallpapers/alpine.mp4",
  },
  {
    id: "night-city",
    label: "Night City",
    labelRu: "Ночной город",
    type: "video",
    src: "/wallpapers/night-city.mp4",
  },
  {
    id: "ocean",
    label: "Ocean Beach",
    labelRu: "Океан",
    type: "video",
    src: "/wallpapers/ocean.mp4",
  },
  {
    id: "autumn-forest",
    label: "Autumn Forest",
    labelRu: "Осенний лес",
    type: "video",
    src: "/wallpapers/autumn-forest.mp4",
  },
]

const STORAGE_KEY = "leaddrive-wallpaper"

interface WallpaperContextValue {
  wallpaper: string | null
  wallpaperDef: WallpaperDef | null
  isWallpaperActive: boolean
  setWallpaper: (id: string | null) => void
}

export const WallpaperContext = createContext<WallpaperContextValue>({
  wallpaper: null,
  wallpaperDef: null,
  isWallpaperActive: false,
  setWallpaper: () => {},
})

export function WallpaperProvider({ children }: { children: ReactNode }) {
  const [wallpaper, setWallpaperState] = useState<string | null>(null)

  // Read from localStorage on mount (don't set data-wallpaper — DashboardWallpaper handles that)
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && WALLPAPERS.some((w) => w.id === saved)) {
      setWallpaperState(saved)
    }
  }, [])

  const setWallpaper = useCallback((id: string | null) => {
    setWallpaperState(id)
    if (id) {
      localStorage.setItem(STORAGE_KEY, id)
    } else {
      localStorage.removeItem(STORAGE_KEY)
      document.documentElement.removeAttribute("data-wallpaper")
    }
  }, [])

  const wallpaperDef = wallpaper ? WALLPAPERS.find((w) => w.id === wallpaper) ?? null : null

  return (
    <WallpaperContext.Provider
      value={{ wallpaper, wallpaperDef, isWallpaperActive: !!wallpaper, setWallpaper }}
    >
      {children}
    </WallpaperContext.Provider>
  )
}
