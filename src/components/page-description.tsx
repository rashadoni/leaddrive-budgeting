"use client"

import { type LucideIcon } from "lucide-react"

interface PageDescriptionProps {
  text?: string
  icon?: LucideIcon
  title?: string
  description?: string
}

export function PageDescription({ text, icon: Icon, title, description }: PageDescriptionProps) {
  if (Icon || title) {
    return (
      <div className="flex items-center gap-3 -mt-1 mb-4">
        {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
        <div>
          {title && <h2 className="text-sm font-medium">{title}</h2>}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
    )
  }
  return (
    <p className="text-sm text-muted-foreground -mt-1 mb-4">{text}</p>
  )
}
