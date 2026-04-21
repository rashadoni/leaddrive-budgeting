"use client"

import { Image as ImageIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useWallpaper } from "@/hooks/use-wallpaper"
import { WALLPAPERS } from "@/contexts/wallpaper-context"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

export function WallpaperSelector() {
  const { wallpaper, setWallpaper } = useWallpaper()
  const t = useTranslations("common")

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t("wallpaper") ?? "Wallpaper"}
          className={cn(wallpaper && "text-primary")}
        >
          <ImageIcon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">{t("wallpaper") ?? "Wallpaper"}</p>
          {wallpaper && (
            <button
              onClick={() => setWallpaper(null)}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-3 w-3" />
              {t("off") ?? "Off"}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {WALLPAPERS.map((w) => (
            <button
              key={w.id}
              onClick={() => setWallpaper(w.id)}
              className={cn(
                "group relative overflow-hidden rounded-lg border-2 transition-all",
                wallpaper === w.id
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-transparent hover:border-border"
              )}
            >
              <video
                src={w.src}
                muted
                playsInline
                preload="metadata"
                className="aspect-[5/3] w-full rounded-md object-cover"
                onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
              />
              <p className="mt-1 text-[10px] font-medium text-center pb-1">
                {w.labelRu}
              </p>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
