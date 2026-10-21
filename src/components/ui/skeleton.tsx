import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("skeleton-shimmer relative overflow-hidden rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
