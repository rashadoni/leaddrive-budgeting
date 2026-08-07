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
  const isBoardDeck = pathname?.startsWith("/budgeting/board-deck") ?? false

  return (
    <QueryClientProvider client={queryClient}>
      <div className={`flex h-screen ${isBoardDeck ? "print:block print:h-auto" : ""}`}>
        <div
          data-testid="dashboard-sidebar-slot"
          className={`${isFullBleed ? "hidden md:contents" : "contents"} ${isBoardDeck ? "print:hidden" : ""}`.trim()}
        >
          <Sidebar />
        </div>
        <div className={`flex flex-1 flex-col overflow-hidden ${isBoardDeck ? "print:block print:overflow-visible" : ""}`}>
          <div data-testid="dashboard-header-slot" className={isBoardDeck ? "print:hidden" : ""}>
            <Header
              orgName={user?.organizationName || "BudgetPro"}
              userName={user?.name || "User"}
              compact={isFullBleed}
            />
          </div>
          <main
            className={`${
              isFullBleed
                ? "flex-1 min-h-0 bg-background relative overflow-hidden"
                : "flex-1 overflow-y-auto bg-background p-8 relative"
            } ${isBoardDeck ? "print:overflow-visible print:bg-white print:p-0" : ""}`.trim()}
          >
            {/* Section help video — an in-flow card at the top of the content
                (never a floating overlay), so it doesn't cover the work area.
                Expands into a modal on click. Renders null on routes with no
                mapped video.

                On the full-bleed terminal the card is suppressed: those four
                panels are sized against the viewport, so a strip above them is
                height taken off every panel at once, and the owner asked for it
                back. The launcher stays MOUNTED with `inlineCard={false}` —
                unmounting it would silence the `budgetpro:open-help-video`
                listener and leave the header's video button dispatching into
                nothing. The icon beside the language switcher is the way in
                there. */}
            <div
              data-testid="dashboard-help-video-slot"
              className={isBoardDeck ? "print:hidden" : ""}
            >
              <HelpVideoLauncher inlineCard={!isFullBleed} />
            </div>
            {children}
          </main>
        </div>
      </div>
    </QueryClientProvider>
  )
}
