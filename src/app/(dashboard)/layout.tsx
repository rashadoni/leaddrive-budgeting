"use client"

import { useSession } from "next-auth/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const user = session?.user

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header
            orgName={user?.organizationName || "BudgetPro"}
            userName={user?.name || "User"}
          />
          <main className="flex-1 overflow-y-auto bg-background p-8 relative">
            {children}
          </main>
        </div>
      </div>
    </QueryClientProvider>
  )
}
