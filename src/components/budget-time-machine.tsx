"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { Clock, RotateCcw, ChevronDown, ChevronUp, History, ChevronLeft, ChevronRight, Eye } from "lucide-react"
import { formatTimePoint } from "@/lib/budgeting/time-machine-utils"
import type { TimePoint } from "@/lib/budgeting/time-machine-utils"

interface BudgetTimeMachineProps {
  timePoints: TimePoint[]
  isActive: boolean
  isLoading?: boolean
  currentIndex: number
  onActivate: () => void
  onDeactivate: () => void
  onIndexChange: (index: number) => void
}

export function BudgetTimeMachine({
  timePoints,
  isActive,
  isLoading,
  currentIndex,
  onActivate,
  onDeactivate,
  onIndexChange,
}: BudgetTimeMachineProps) {
  const [collapsed, setCollapsed] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSliderChange = useCallback(
    (value: number[]) => {
      const idx = value[0]
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onIndexChange(idx)
      }, 200)
    },
    [onIndexChange]
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  if (timePoints.length === 0) {
    return null
  }

  const currentPoint = timePoints[currentIndex]
  const canGoPrev = currentIndex > 0
  const canGoNext = currentIndex < timePoints.length - 1

  // Collapsed / inactive state
  if (!isActive) {
    // Show last change summary
    const lastPoint = timePoints[timePoints.length - 1]
    return (
      <Card className="border-dashed border-purple-300 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-950/20">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <History className="h-4 w-4 text-purple-500" />
              <span>
                Budget History — <strong>{timePoints.length}</strong> edit{timePoints.length !== 1 ? "s" : ""} recorded
              </span>
              <span className="text-xs opacity-60">
                · last: {formatTimePoint(lastPoint.timestamp)}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={onActivate} className="border-purple-300 text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-900">
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              View Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-2 border-purple-400 dark:border-purple-600 bg-purple-50/70 dark:bg-purple-950/30 shadow-lg shadow-purple-100 dark:shadow-purple-900/20">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-purple-600 dark:text-purple-400 animate-pulse" />
            <CardTitle className="text-base font-semibold text-purple-900 dark:text-purple-100">
              Budget History
            </CardTitle>
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs">
              Read-only mode
            </Badge>
            {isLoading && (
              <Badge variant="outline" className="text-xs animate-pulse">
                Loading...
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
              className="h-7 w-7 p-0"
            >
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={onDeactivate}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Back to Live
            </Button>
          </div>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="pt-1 pb-3 px-4">
          <div className="space-y-3">
            {/* Slider with prev/next buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0 shrink-0"
                disabled={!canGoPrev}
                onClick={() => onIndexChange(currentIndex - 1)}
                title="Previous change"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Slider
                min={0}
                max={timePoints.length - 1}
                step={1}
                value={[currentIndex]}
                onValueChange={handleSliderChange}
                className="[&_[role=slider]]:bg-purple-600 [&_[role=slider]]:border-purple-700 [&_[role=slider]]:shadow-purple-300 [&_.range]:bg-purple-500"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0 shrink-0"
                disabled={!canGoNext}
                onClick={() => onIndexChange(currentIndex + 1)}
                title="Next change"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Current point info */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {formatTimePoint(timePoints[0].timestamp)}
              </span>

              {/* Center: current checkpoint details */}
              <div className="flex flex-col items-center">
                <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                  {currentPoint ? formatTimePoint(currentPoint.timestamp) : "Select a point"}
                </span>
                {currentPoint && (
                  <span className="text-xs text-muted-foreground">
                    {currentPoint.summary} · checkpoint {currentIndex + 1} of {timePoints.length}
                  </span>
                )}
              </div>

              <span className="text-xs text-muted-foreground">
                {formatTimePoint(timePoints[timePoints.length - 1].timestamp)}
              </span>
            </div>

            {/* Hint */}
            <p className="text-[11px] text-muted-foreground/70 text-center">
              Drag the slider or use arrows to see how your budget looked at each point in time. All data below reflects the selected moment.
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
