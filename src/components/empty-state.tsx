import { Button } from "@/components/ui/button"

interface EmptyStateProps {
  icon: React.ElementType
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in-up">
      <div className="rounded-full bg-foreground/[0.06] dark:bg-white/[0.06] p-4 mb-4">
        <Icon className="h-8 w-8 text-foreground/30 dark:text-white/30" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
      {action && (
        <Button variant="brand" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
