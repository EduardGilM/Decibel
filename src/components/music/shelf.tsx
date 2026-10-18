"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"

export function Shelf({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-4 md:px-6">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {href && (
          <Link href={href} className="text-[13px] font-medium text-muted-foreground hover:text-foreground hover:underline">
            Mostrar todos
          </Link>
        )}
      </div>
      <ScrollArea className="w-full">
        <div className="flex w-max gap-1 px-2 pb-3 md:px-4 [&>*]:w-36 sm:[&>*]:w-44">{children}</div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  )
}

export function ShelfSkeleton() {
  return (
    <section className="flex flex-col gap-3 px-4 md:px-6">
      <Skeleton className="h-6 w-48" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex w-36 shrink-0 flex-col gap-2 sm:w-44">
            <Skeleton className="aspect-square w-full rounded-md" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </section>
  )
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-1 px-2 sm:grid-cols-3 md:px-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{children}</div>
}
