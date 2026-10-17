"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"
import { cn } from "@meshguard/ui/lib/utils"

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
    color?: string
  }
}

type ChartContextProps = { config: ChartConfig }

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) throw new Error("useChart must be used within a <ChartContainer />")
  return context
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"]
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`

  const colors = Object.entries(config).filter(([, c]) => c.color)

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border flex aspect-video justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className
        )}
        {...props}
      >
        {colors.length > 0 && (
          <style
            dangerouslySetInnerHTML={{
              __html: `[data-chart=${chartId}] {\n${colors
                .map(([key, c]) => `  --color-${key}: ${c.color};`)
                .join("\n")}\n}`,
            }}
          />
        )}
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

function ChartTooltipContent({
  active,
  payload,
  className,
  label,
  labelFormatter,
  hideLabel = false,
}: {
  active?: boolean
  payload?: Array<{
    dataKey?: string | number
    name?: string | number
    value?: string | number
    color?: string
    payload?: Record<string, unknown>
  }>
  className?: string
  label?: React.ReactNode
  labelFormatter?: (label: React.ReactNode, payload: unknown[]) => React.ReactNode
  hideLabel?: boolean
}) {
  const { config } = useChart()

  if (!active || !payload?.length) return null

  const heading = hideLabel
    ? null
    : labelFormatter
      ? labelFormatter(label, payload)
      : label

  return (
    <div
      className={cn(
        "border-border/50 bg-background grid min-w-32 items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl",
        className
      )}
    >
      {heading && <div className="font-medium">{heading}</div>}
      <div className="grid gap-1.5">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name)
          const itemConfig = config[key]
          return (
            <div key={key} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: item.color }}
              />
              <span className="text-muted-foreground">{itemConfig?.label ?? item.name}</span>
              <span className="text-foreground ml-auto font-mono font-medium tabular-nums">
                {item.value?.toLocaleString()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { ChartContainer, ChartTooltip, ChartTooltipContent }
