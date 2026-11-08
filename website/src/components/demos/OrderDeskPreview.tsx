import React from "react";
import { Clock, DollarSign, Truck } from "lucide-react";
import { BarChart, ChartCard, KpiGrid, KpiTile } from "@rebasepro/ui";
import type { Bar } from "@rebasepro/ui";

/* The home page's 0.29 section shows the order desk as code beside this.
   These are the kit's own `KpiTile`, `KpiGrid`, `ChartCard` and `BarChart`,
   imported from `@rebasepro/ui` source as every demo on the site is — not a
   drawing of them. Only the figures are made up, and the frame around this
   island says so. The list and the form in the code need a running backend
   (`CollectionPanel` and `RecordForm` read through `<Rebase>`), so they are
   not drawn here rather than faked. */

const BY_STATUS: Bar[] = [
    { key: "delivered", label: "delivered", value: 412 },
    { key: "shipped", label: "shipped", value: 142 },
    { key: "confirmed", label: "confirmed", value: 37 },
    { key: "pending", label: "pending", value: 18 },
    { key: "cancelled", label: "cancelled", value: 9 },
];

export function OrderDeskPreview() {
    return (
        <div className="flex flex-col gap-4 p-4 sm:p-5">
            <KpiGrid>
                <KpiTile label="Pending" icon={<Clock size={14}/>}
                    value={18} previous={23} goodWhen="down" periodDays={7}/>
                <KpiTile label="Shipped" icon={<Truck size={14}/>}
                    value={142} previous={126} periodDays={7}/>
                <KpiTile label="Revenue" icon={<DollarSign size={14}/>}
                    value={36600} previous={35150} periodDays={7}
                    format={{ style: "currency", currency: "USD", notation: "compact" }}/>
            </KpiGrid>
            <ChartCard title="Orders by status">
                <BarChart bars={BY_STATUS}/>
            </ChartCard>
        </div>
    );
}
