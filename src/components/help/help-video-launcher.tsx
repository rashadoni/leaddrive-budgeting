"use client"

import Image from "next/image"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useLocale, useTranslations } from "next-intl"
import { usePathname, useSearchParams } from "next/navigation"
import { Minimize2, Play, Video, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  formatHelpVideoTitle,
  getHelpVideoAsset,
  getHelpVideoForPath,
  getHelpVideoForSlug,
  normalizeHelpVideoLocale,
  type HelpVideoEntry,
} from "@/content/help/video-assets"

type VideoMode = "expanded" | "thumbnail" | "hidden"

interface StoredVideoState {
  expandedSeen?: boolean
  thumbnailDismissed?: boolean
}

const STATE_EVENT = "budgetpro:help-video-state"
const OPEN_EVENT = "budgetpro:open-help-video"

function readStoredState(key: string): StoredVideoState {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "{}") as StoredVideoState
  } catch {
    return {}
  }
}

function writeStoredState(key: string, value: StoredVideoState) {
  window.localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new Event(STATE_EVENT))
}

function storageKey(entry: HelpVideoEntry, locale: string) {
  return `bp_help_video:v1:${entry.slug}:${locale}`
}

function modeFromStorage(key: string | null): VideoMode {
  if (!key || typeof window === "undefined") return "hidden"

  // 2026-08-04 — the card no longer hides itself, on the owner's call.
  //
  // It used to carry an X that set `thumbnailDismissed` in localStorage, and
  // the dismissal was permanent and per-section. One accidental click and the
  // guide was gone with no visible trace — which is exactly what happened: the
  // owner reported "the video disappeared after the update" when the video was
  // fine and their browser had simply remembered the dismissal.
  //
  // `thumbnailDismissed` is deliberately still READ nowhere rather than
  // deleted from the type: browsers already carry it from before this change,
  // and ignoring it is what brings those cards back without asking anyone to
  // clear storage by hand.
  readStoredState(key)
  return "thumbnail"
}

function subscribeToStoredState(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {}

  window.addEventListener("storage", onStoreChange)
  window.addEventListener(STATE_EVENT, onStoreChange)
  return () => {
    window.removeEventListener("storage", onStoreChange)
    window.removeEventListener(STATE_EVENT, onStoreChange)
  }
}

/**
 * `inlineCard: false` suppresses the in-flow card WITHOUT unmounting the
 * launcher. The distinction matters: the `budgetpro:open-help-video` listener
 * lives in this component, so a layout that simply stopped rendering it would
 * turn the header's video button into a control that dispatches an event
 * nobody hears — the exact dead-control failure `help-video-button.tsx` was
 * written to fix. Mounted-but-cardless keeps the header button working and the
 * modal reachable; only the strip of vertical space goes away.
 *
 * Used by the Risk Terminal, where the four panels are sized against the
 * viewport and a card above them takes height off every one of them.
 */
export function HelpVideoLauncher({ inlineCard = true }: { inlineCard?: boolean } = {}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchKey = searchParams.toString()
  const locationKey = `${pathname ?? ""}?${searchKey}`
  const rawLocale = useLocale()
  const locale = normalizeHelpVideoLocale(rawLocale)
  const routeEntry = useMemo(
    () => getHelpVideoForPath(pathname, searchKey),
    [pathname, searchKey],
  )
  const [manualEntryState, setManualEntryState] = useState<{
    entry: HelpVideoEntry
    locationKey: string
  } | null>(null)
  const manualEntry = manualEntryState?.locationKey === locationKey ? manualEntryState.entry : null
  const entry = manualEntry ?? routeEntry
  const [sessionMode, setSessionMode] = useState<{ key: string; mode: VideoMode } | null>(null)
  const [posterFailedKey, setPosterFailedKey] = useState<string | null>(null)
  const [videoFailedKey, setVideoFailedKey] = useState<string | null>(null)

  const t = useTranslations("helpVideo")
  const assets = entry ? getHelpVideoAsset(entry, locale) : null
  const title = entry ? formatHelpVideoTitle(entry.slug) : t("title")
  const currentStorageKey = entry ? storageKey(entry, locale) : null
  const storedMode = useSyncExternalStore(
    subscribeToStoredState,
    () => modeFromStorage(currentStorageKey),
    () => "hidden"
  )
  const mode = sessionMode?.key === currentStorageKey ? sessionMode.mode : storedMode
  const posterFailed = posterFailedKey === currentStorageKey
  const videoUnavailable = videoFailedKey === currentStorageKey

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<{ slug?: string }>).detail
      const nextEntry = detail?.slug ? getHelpVideoForSlug(detail.slug) : routeEntry
      if (!nextEntry) return

      setManualEntryState({ entry: nextEntry, locationKey })
      setSessionMode({ key: storageKey(nextEntry, locale), mode: "expanded" })
    }

    window.addEventListener(OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(OPEN_EVENT, handleOpen)
  }, [locale, locationKey, routeEntry])

  if (!entry || !assets || mode === "hidden") {
    return null
  }

  function minimize() {
    if (currentStorageKey) {
      writeStoredState(currentStorageKey, { expandedSeen: true })
      setSessionMode({ key: currentStorageKey, mode: "thumbnail" })
    }
  }

  // 2026-08-04 — `close()` is gone. It set `thumbnailDismissed` and hid the
  // card permanently for that section; both the card's X and the modal's X ran
  // it, so watching the video once could remove its own entry point. The
  // modal's X now calls `minimize`, which returns to the card.

  function markPosterFailed() {
    if (currentStorageKey) setPosterFailedKey(currentStorageKey)
  }

  function markVideoFailed() {
    if (currentStorageKey) setVideoFailedKey(currentStorageKey)
  }

  function expand() {
    if (currentStorageKey) {
      writeStoredState(currentStorageKey, { expandedSeen: true })
      setSessionMode({ key: currentStorageKey, mode: "expanded" })
    }
  }

  // Card suppressed for this surface — the header button is the way in. The
  // modal below is still reachable, which is why this returns only here rather
  // than at the top of the component.
  if (mode === "thumbnail" && !inlineCard) {
    return null
  }

  if (mode === "thumbnail") {
    // Inline, in-flow card at the top of the section — it pushes the page content
    // down instead of floating over it, so it never covers the work area.
    // Clicking the poster or "Open video" expands into a modal.
    return (
      <TooltipProvider delayDuration={200}>
        <aside className="mb-4" data-help-video-widget>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
            <div className="flex items-center gap-3 p-3 sm:gap-4">
              <button
                type="button"
                onClick={expand}
                className="group relative aspect-video w-[112px] shrink-0 overflow-hidden rounded-lg text-left sm:w-[160px]"
                aria-label={t("play")}
              >
                {posterFailed ? (
                  <span className="flex h-full w-full items-center justify-center bg-muted text-primary">
                    <Video className="h-6 w-6" />
                  </span>
                ) : (
                  <Image
                    src={assets.posterSrc}
                    alt=""
                    fill
                    sizes="160px"
                    unoptimized
                    onError={markPosterFailed}
                    className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                  />
                )}
                <span className="absolute inset-0 bg-black/15 transition group-hover:bg-black/25" aria-hidden="true" />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition group-hover:scale-110">
                    <Play className="h-4 w-4 fill-current" />
                  </span>
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
                  <Video className="h-3.5 w-3.5" />
                  <span>{t("eyebrow")}</span>
                </div>
                <p className="mt-0.5 line-clamp-1 break-words text-sm font-semibold leading-5">{title || t("title")}</p>
                <p className="mt-0.5 line-clamp-1 hidden text-xs text-muted-foreground sm:block">{t("subtitle")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="hidden h-8 gap-1.5 px-3 text-xs sm:inline-flex"
                  onClick={expand}
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  {t("play")}
                </Button>
                {/* 2026-08-04 — no dismiss control here on purpose. The card is
                    in-flow and small; the X made it disappear permanently for
                    that section, which read as the guide breaking. The modal
                    still closes with its own X. */}
              </div>
            </div>
          </div>
        </aside>
      </TooltipProvider>
    )
  }

  // Expanded → a centered modal the user opened on purpose (backdrop click or
  // "minimize" returns to the inline card). It overlays deliberately, never by
  // default, so it doesn't get in the way of the work area.
  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        onClick={minimize}
      >
        <div
          className="w-[min(900px,100%)] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl shadow-black/25"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-primary">
                <Video className="h-3.5 w-3.5" />
                <span>{t("eyebrow")}</span>
              </div>
              <h2 className="line-clamp-2 break-words text-sm font-semibold leading-5">
                {title || t("title")}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={minimize}
                    aria-label={t("minimize")}
                  >
                    <Minimize2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("minimize")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={minimize}
                    aria-label={t("close")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("close")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          {videoUnavailable ? (
            <div className="flex aspect-video max-h-[70vh] w-full flex-col items-center justify-center gap-3 bg-muted/50 px-6 py-10 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Video className="h-6 w-6" />
              </span>
              <div className="max-w-md">
                <p className="text-sm font-semibold text-foreground">{t("unavailableTitle")}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("unavailableBody")}</p>
                <p className="mt-3 text-xs font-medium text-primary">{t("unavailableHint")}</p>
              </div>
            </div>
          ) : (
            <video
              key={`${entry.slug}.${locale}`}
              className="aspect-video max-h-[70vh] w-full bg-zinc-950"
              controls
              autoPlay
              playsInline
              preload="metadata"
              poster={posterFailed ? undefined : assets.posterSrc}
              src={assets.videoSrc}
              onError={markVideoFailed}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
