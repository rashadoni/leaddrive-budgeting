"use client"

import { useSession } from "next-auth/react"
import { usePathname } from "next/navigation"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { HelpVideoLauncher } from "@/components/help/help-video-launcher"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const user = session?.user
  // Sub-37 — Risk Terminal claims the full content slot (no p-8 outer
  // padding, no overflow-y-auto so panels don't double-scroll). Other
  // dashboard pages keep the standard padded scrollable main. Toggled
  // by route prefix because passing a flag through App-Router layouts
  // requires a context provider — not worth the indirection for one route.
  const pathname = usePathname()
  const isFullBleed = pathname?.startsWith("/budgeting/terminal") ?? false

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen">
        <div
          data-testid="dashboard-sidebar-slot"
          className={isFullBleed ? "hidden md:contents" : "contents"}
        >
          <Sidebar />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header
            orgName={user?.organizationName || "BudgetPro"}
            userName={user?.name || "User"}
            compact={isFullBleed}
          />
          <main
            className={
              isFullBleed
                ? "flex-1 min-h-0 bg-background relative overflow-hidden"
                : "flex-1 overflow-y-auto bg-background p-8 relative"
            }
          >
            {/* Section help video — an in-flow card at the top of the content
                (never a floating overlay), so it doesn't cover the work area.
                Expands into a modal on click. Renders null on routes with no
                mapped video (e.g. the full-bleed terminal). */}
            <HelpVideoLauncher />
            {children}
          </main>
        </div>
      </div>
    </QueryClientProvider>
  )
}
