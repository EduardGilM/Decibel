"use client"

import type { LucideIcon } from "lucide-react"
import { AlertCircle } from "lucide-react"
import type { ReactNode } from "react"

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Icon className="size-10 text-muted-foreground" />
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}

export function ErrorState({ error }: { error: Error }) {
  return (
    <EmptyState icon={AlertCircle} title="Algo ha fallado">
      {error.message}
    </EmptyState>
  )
}
