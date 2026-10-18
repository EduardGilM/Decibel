"use client"

import { TopBar } from "@/components/music/top-bar"
import { QueueList } from "@/components/player/queue-list"

export default function QueuePage() {
  return (
    <div>
      <TopBar title="Cola" />
      <div className="flex flex-col gap-4 px-2 pt-2 md:px-4">
        <h1 className="hidden px-2 text-3xl font-bold tracking-tight md:block">Cola</h1>
        <QueueList className="max-w-3xl" />
      </div>
    </div>
  )
}
