// REWRITTEN after the original was lost. Shapes mirror demo-objects/ so the
// standalone harness (npm run dev) behaves like the real Objects.
import type { ObjectTarget } from "./types";

const text = (name: string, label: string) =>
  ({ name, label, type: "text", businessType: "Text" }) as const;
const num = (name: string, label: string) =>
  ({ name, label, type: "number", businessType: "PrecisionDecimal" }) as const;
const date = (name: string, label: string) =>
  ({ name, label, type: "date", businessType: "Date" }) as const;

export const MOCK_TARGETS: ObjectTarget[] = [
  {
    externalReferenceCode: "SALESORDER",
    objectName: "Sales Order",
    restContextPath: "/o/c/salesorders",
    fields: [
      text("orderNumber", "Order Number"),
      text("region", "Region"),
      text("productCategory", "Product Category"),
      text("channel", "Channel"),
      text("orderStatus", "Status"),
      num("amount", "Amount"),
      num("quantity", "Quantity"),
      date("orderDate", "Order Date"),
    ],
  },
  {
    externalReferenceCode: "SUPPORTTICKET",
    objectName: "Support Case",
    restContextPath: "/o/c/supportcases",
    fields: [
      text("ticketNumber", "Ticket Number"),
      text("priority", "Priority"),
      text("ticketStatus", "Status"),
      text("channel", "Channel"),
      text("category", "Category"),
      num("resolutionHours", "Resolution Hours"),
      num("satisfactionScore", "Satisfaction Score"),
      date("createdDate", "Created Date"),
    ],
  },
];

const REGIONS = ["North America", "EMEA", "APAC", "LATAM"];
const CATEGORIES = ["Hardware", "Software", "Services", "Training"];
const CHANNELS = ["Direct", "Partner", "Online"];
const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
// Mirrors the seeded data's monotonic story: Low resolves fast, Critical slow.
const RESOLUTION = { Low: 3.6, Medium: 8.2, High: 14.7, Critical: 29.3 };

// A tiny deterministic PRNG so the harness and any screenshots are stable.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];

const salesOrders = Array.from({ length: 120 }, (_, i) => ({
  orderNumber: `SO-${1000 + i}`,
  region: pick(REGIONS),
  productCategory: pick(CATEGORIES),
  channel: pick(CHANNELS),
  orderStatus: pick(["Won", "Pending", "Lost"]),
  amount: Math.round(1500 + rnd() * 22500),
  quantity: 1 + Math.floor(rnd() * 40),
  orderDate: `${pick(MONTHS)}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
}));

const supportCases = Array.from({ length: 140 }, (_, i) => {
  const priority = pick(PRIORITIES) as keyof typeof RESOLUTION;
  return {
    ticketNumber: `TK-${2000 + i}`,
    priority,
    ticketStatus: pick(["Open", "In Progress", "Resolved", "Closed"]),
    channel: pick(["Email", "Chat", "Phone", "Portal"]),
    category: pick(["Bug", "Question", "Feature Request", "Billing"]),
    resolutionHours: Math.round((RESOLUTION[priority] * (0.6 + rnd() * 0.8)) * 10) / 10,
    satisfactionScore: 1 + Math.floor(rnd() * 5),
    createdDate: `${pick(MONTHS)}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
  };
});

export const MOCK_ENTRIES: Record<string, Record<string, unknown>[]> = {
  "/o/c/salesorders": salesOrders,
  "/o/c/supportcases": supportCases,
};
