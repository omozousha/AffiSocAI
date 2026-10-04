import * as React from "react";
import { DayPicker } from "react-day-picker";

import { cn } from "../../lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-1 text-zinc-100", className)}
      classNames={{
        months: "flex flex-col gap-2",
        month: "space-y-2",
        month_caption: "flex justify-center relative items-center h-8",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1 absolute inset-x-0 justify-between px-1",
        button_previous: "h-7 w-7 rounded-md border border-zinc-700 bg-transparent p-0 opacity-70 hover:opacity-100",
        button_next: "h-7 w-7 rounded-md border border-zinc-700 bg-transparent p-0 opacity-70 hover:opacity-100",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-center text-xs text-zinc-500 font-normal",
        weeks: "mt-1",
        week: "flex w-full",
        day: "h-9 w-9 p-0 text-center text-sm",
        day_button: "h-9 w-9 rounded-md p-0 font-normal hover:bg-zinc-800 aria-selected:bg-accent/80 aria-selected:text-[#0b0c0e]",
        today: "border border-accent/60",
        outside: "text-zinc-600 opacity-50",
        disabled: "text-zinc-700 opacity-40",
        selected: "bg-accent text-[#0b0c0e] hover:bg-accent/85",
        ...classNames,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
